import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectDeleteCommand } from "../project-delete";
import type { ProjectDeleteArgs, ProjectDeleteDeps } from "../project-delete";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** A throwaway HOME holding a fake ~/.claude tree and config. */
function setup(options: { config?: Record<string, unknown> | null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  const projectsDir = join(home, ".claude", "projects");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  const configPath = join(home, ".claude.json");
  function writeConfig(config: Record<string, unknown>) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  if (options.config !== null) writeConfig(options.config ?? { projects: {} });

  const sleeps: Bun.Subprocess[] = [];
  cleanups.push(() => {
    for (const p of sleeps) p.kill();
    rmSync(home, { recursive: true, force: true });
  });

  /** Write one project directory with a transcript per session id. */
  function addProject(cwd: string, sessionIds: string[]) {
    const dir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const path = join(projectsDir, dir);
    mkdirSync(path, { recursive: true });
    for (const id of sessionIds) {
      const file = join(path, `${id}.jsonl`);
      writeFileSync(file, JSON.stringify({ cwd, type: "summary" }) + "\n");
      utimesSync(file, Date.now() / 1000, Date.now() / 1000);
    }
    return { dir, path };
  }

  /** Register a live session backed by a `sleep`, so it counts as active. */
  function addSession(name: string, cwd: string) {
    const proc = Bun.spawn(["sleep", "30"]);
    sleeps.push(proc);
    writeFileSync(
      join(sessionsDir, `${proc.pid}.json`),
      JSON.stringify({
        pid: proc.pid,
        sessionId: `session-${proc.pid}`,
        name,
        cwd,
        status: "idle",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }

  function readConfig(path = configPath): {
    numStartups?: number;
    projects: Record<string, Record<string, unknown>>;
  } {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  async function run(...args: string[]) {
    const proc = Bun.spawn([process.execPath, CLI, ...args], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, out, err };
  }

  return { home, configPath, addProject, addSession, writeConfig, readConfig, run };
}

describe("project-delete", () => {
  it("refuses without --yes and keeps the project and its trust", async () => {
    const proj = { dir: "w-use-stock", cwd: "/w/use-stock", sessions: 2, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({ readProjects: async () => [proj], readSessions: async () => [], existsSync: () => true, stat: async () => ({ isDirectory: () => true }) })({ target: "use-stock", yes: false } as ProjectDeleteArgs);

    expect(result.success).toBe(false);
    expect(result.message).toContain("without --yes");
  });

  it("deletes the whole project directory with --yes", async () => {
    const proj = { dir: "w-use-stock", cwd: "/w/use-stock", sessions: 2, updatedAt: Date.now() } as any;
    const rmCalls: { path: string; opts: { recursive: boolean; force: boolean } }[] = [];
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async (p, opts) => { rmCalls.push({ path: p, opts }); },
        forgetProjectConfig: async () => ({ removed: [], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "/w/use-stock", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(rmCalls.length).toBe(1);
    expect(rmCalls[0].path).toBe("/tmp/fake-projects/w-use-stock");
  });

  it("resets the project's trust entry and preserves other config", async () => {
    const proj = { dir: "w-use-stock", cwd: "/w/use-stock", sessions: 2, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: ["/w/use-stock"], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "/w/use-stock", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Reset trust config for /w/use-stock");
  });

  it("--keep-config preserves the trust entry", async () => {
    const proj = { dir: "w-use-stock", cwd: "/w/use-stock", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
      })({ target: "/w/use-stock", yes: true, "keep-config": true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Kept Claude Code trust config");
  });

  it("accepts a unique workspace-path suffix", async () => {
    const proj = { dir: "Volumes-GoldenSnake-git-use-stock", cwd: "/Volumes/GoldenSnake/git/use-stock", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: [], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "git/use-stock", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
  });

  it("refuses while a live session runs there, unless --force", async () => {
    const proj = { dir: "w-alpha", cwd: "/w/alpha", sessions: 1, updatedAt: Date.now() } as any;
    const session = { cwd: "/w/alpha" } as any;
    const deps = {
      readProjects: async () => [proj],
      readSessions: async () => [session],
      existsSync: () => true,
      stat: async () => ({ isDirectory: () => true }),
      projectsDir: "/tmp/fake-projects",
      rm: async () => {},
      forgetProjectConfig: async () => ({ removed: [], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
    };

    const blocked = await projectDeleteCommand.create(deps)({ target: "/w/alpha", yes: true } as ProjectDeleteArgs);
    expect(blocked.success).toBe(false);
    expect(blocked.message).toContain("1 active session");

    const forced = await projectDeleteCommand.create(deps)({ target: "/w/alpha", yes: true, force: true } as ProjectDeleteArgs);
    expect(forced.success).toBe(true);
    expect(forced.message).toContain("may restore its config entry");
  });

  it("--dry-run reports both deletions without changing anything", async () => {
    const proj = { dir: "w-alpha", cwd: "/w/alpha", sessions: 1, updatedAt: Date.now() } as any;
    const session = { cwd: "/w/alpha" } as any;
    const rmCalls: any[] = [];
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [session],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async (p: any, opts: any) => { rmCalls.push({ p, opts }); },
        forgetProjectConfig: async () => ({ removed: ["/w/alpha"], expiredAncestors: ["/w"], configPath: "/tmp/.claude.json", dryRun: true }),
      })({ target: "/w/alpha", "dry-run": true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Would delete /w/alpha (1 session)");
    expect(result.message).toContain("Would reset trust config for /w/alpha");
    expect(result.message).toContain("Would clear inherited trust for /w");
    expect(result.message).toContain("--force would be required");
    expect(rmCalls.length).toBe(0);
  });

  it("resets trust under the git root for a folder inside a repository", async () => {
    const proj = { dir: "repo-packages-app", cwd: "/repo/sub/project", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: ["/repo/sub/project"], expiredAncestors: ["/repo"], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "/repo/sub/project", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Reset trust config");
    expect(result.message).toContain("inherited trust");
  });

  it("writes through a symlinked ~/.claude.json without replacing the link", async () => {
    const proj = { dir: "w-alpha", cwd: "/w/alpha", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: ["/w/alpha"], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "/w/alpha", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Reset trust config");
  });

  it("resets an existing folder whose transcripts are already gone", async () => {
    const candidate = "/tmp/existing-folder";
    const result = await projectDeleteCommand.create({
        readProjects: async () => [],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: [candidate], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: candidate, yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("(0 sessions)");
  });

  it("clears inherited trust on ancestors so the prompt returns", async () => {
    const proj = { dir: "w-alpha", cwd: "/w/alpha", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: ["/w/alpha"], expiredAncestors: ["/w"], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "/w/alpha", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared inherited trust");
    expect(result.message).toContain("/w");
  });

  it("deletes without a config file", async () => {
    const proj = { dir: "w-alpha", cwd: "/w/alpha", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({
        readProjects: async () => [proj],
        readSessions: async () => [],
        existsSync: () => true,
        stat: async () => ({ isDirectory: () => true }),
        projectsDir: "/tmp/fake-projects",
        rm: async () => {},
        forgetProjectConfig: async () => ({ removed: [], expiredAncestors: [], configPath: "/tmp/.claude.json", dryRun: false }),
      })({ target: "/w/alpha", yes: true } as ProjectDeleteArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("No Claude Code trust config entry to reset");
  });

  it("reports an unknown target and lists alternatives", async () => {
    const projects = [{ dir: "w-alpha", cwd: "/w/alpha", sessions: 1, updatedAt: Date.now() } as any];
    const result = await projectDeleteCommand.create({ readProjects: async () => projects, existsSync: () => false })({ target: "nope" } as ProjectDeleteArgs);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No project matches "nope"');
    expect(result.message).toContain("use-code-cli projects");
  });

  it("refuses an ambiguous basename and names the candidates", async () => {
    const proj1 = { dir: "w-a-app", cwd: "/w/a/app", sessions: 1, updatedAt: Date.now() } as any;
    const proj2 = { dir: "w-b-app", cwd: "/w/b/app", sessions: 1, updatedAt: Date.now() } as any;
    const result = await projectDeleteCommand.create({ readProjects: async () => [proj1, proj2] })({ target: "app" } as ProjectDeleteArgs);

    expect(result.success).toBe(false);
    expect(result.message).toContain("ambiguous");
    expect(result.message).toContain("/w/a/app");
    expect(result.message).toContain("/w/b/app");
  });
});
