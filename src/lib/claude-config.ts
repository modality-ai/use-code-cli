import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

/** How many of Claude Code's own config backups to keep. */
const MAX_BACKUPS = 5;
const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10_000;

interface ProjectConfig {
  hasTrustDialogAccepted?: boolean;
  [key: string]: unknown;
}

interface GlobalConfig {
  projects?: Record<string, ProjectConfig>;
  [key: string]: unknown;
}

/** The directory Claude Code treats as its config home. */
function configHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/** The suffix Claude Code adds for non-production OAuth configs. */
function oauthSuffix(): string {
  if (process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL) return "-custom-oauth";
  if (process.env.USER_TYPE === "ant") {
    const truthy = (value: string | undefined) =>
      value === "1" || value?.toLowerCase() === "true";
    if (truthy(process.env.USE_LOCAL_OAUTH)) return "-local-oauth";
    if (truthy(process.env.USE_STAGING_OAUTH)) return "-staging-oauth";
  }
  return "";
}

/**
 * The config file Claude Code reads and writes: `~/.claude.json` (honouring
 * CLAUDE_CONFIG_DIR and the legacy `~/.claude/.config.json` location).
 */
function globalConfigPath(): string {
  const legacy = join(configHome(), ".config.json");
  if (existsSync(legacy)) return legacy;
  const base = process.env.CLAUDE_CONFIG_DIR ?? homedir();
  return join(base, `.claude${oauthSuffix()}.json`);
}

/** The backups Claude Code itself writes alongside a config update. */
function backupDir(): string {
  return join(configHome(), "backups");
}

async function canonical(path: string): Promise<string> {
  try {
    return (await realpath(path)).normalize("NFC");
  } catch {
    return resolve(path).normalize("NFC");
  }
}

/**
 * The key Claude Code uses for a folder's trust entry: its canonical git root,
 * or the folder itself when it is not inside a repository.
 */
async function projectConfigKey(cwd: string): Promise<string> {
  const start = await canonical(cwd);
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Serialise with Claude Code's own `~/.claude.json.lock` protocol. */
async function withConfigLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lockPath).catch(() => {});
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${lockPath}`);
      await new Promise((done) => setTimeout(done, 50));
    }
  }

  try {
    return await fn();
  } finally {
    await rmdir(lockPath).catch(() => {});
  }
}

/** Copy the config aside before rewriting it, keeping the newest few. */
async function backupConfig(file: string): Promise<void> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const base = basename(file);
  await copyFile(file, join(dir, `${base}.backup.${Date.now()}`));

  const backups = (await readdir(dir))
    .filter((name) => name.startsWith(`${base}.backup.`))
    .sort();
  const excess = backups.length - MAX_BACKUPS;
  for (const name of backups.slice(0, Math.max(0, excess))) {
    await unlink(join(dir, name)).catch(() => {});
  }
}

/**
 * Clear trust on ancestors of `key`. Claude Code inherits trust from a parent,
 * so leaving one trusted would keep the folder trusted without its own entry.
 */
function expireAncestors(
  projects: Record<string, ProjectConfig>,
  key: string,
): string[] {
  const expired: string[] = [];
  let dir = dirname(key);
  for (;;) {
    const entry = projects[dir];
    if (entry?.hasTrustDialogAccepted === true) {
      projects[dir] = { ...entry, hasTrustDialogAccepted: false };
      expired.push(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return expired;
}

export interface ForgetProjectResult {
  /** The global config file that holds (or would hold) the entry. */
  configPath: string;
  /** The path key Claude Code uses for this workspace (git root or `cwd`). */
  key: string;
  /** Config keys removed (empty when there was no entry or on a dry run). */
  removed: string[];
  /** Ancestors whose inherited trust was cleared. */
  expiredAncestors: string[];
  dryRun: boolean;
}

/**
 * Remove a workspace's entry from Claude Code's global config, clearing its
 * trust, approvals, and per-project stats so the next launch treats the folder
 * as new.
 *
 * The config is re-read under Claude Code's own lock, backed up first, and
 * written through a temp file + rename so a symlinked `~/.claude.json` stays a
 * symlink and a concurrent Claude Code write is not clobbered.
 */
export async function forgetProjectConfig(
  cwd: string,
  options: { dryRun?: boolean } = {},
): Promise<ForgetProjectResult> {
  const configPath = globalConfigPath();
  const key = await projectConfigKey(cwd);
  const dryRun = options.dryRun === true;

  if (!existsSync(configPath)) {
    return { configPath, key, removed: [], expiredAncestors: [], dryRun };
  }

  const file = await realpath(configPath);
  const folder = await canonical(cwd);

  return withConfigLock(file, async () => {
    const config = JSON.parse(await readFile(file, "utf8")) as GlobalConfig;
    const projects = config.projects ?? {};
    const removed: string[] = [];

    for (const candidate of Object.keys(projects)) {
      // The workspace key, plus any path alias pointing at the same folder.
      if (candidate === key || (await canonical(candidate)) === folder) {
        delete projects[candidate];
        removed.push(candidate);
      }
    }

    const expiredAncestors = expireAncestors(projects, key);
    if ((removed.length > 0 || expiredAncestors.length > 0) && !dryRun) {
      config.projects = projects;
      await backupConfig(file);
      const mode = (await stat(file)).mode & 0o777;
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode });
      await rename(tmp, file);
    }

    return {
      configPath,
      key,
      removed,
      expiredAncestors,
      dryRun,
    };
  });
}
