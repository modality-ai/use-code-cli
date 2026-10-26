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
    const h = setup({
      config: {
        projects: { "/w/use-stock": { hasTrustDialogAccepted: true } },
      },
    });
    const { path } = h.addProject("/w/use-stock", ["a", "b"]);

    const res = await h.run("project-delete", "use-stock");

    expect(res.code).toBe(1);
    expect(res.err).toContain("without --yes");
    expect(existsSync(path)).toBe(true);
    expect(h.readConfig().projects["/w/use-stock"]).toBeDefined();
  });

  it("deletes the whole project directory with --yes", async () => {
    const h = setup();
    const { path } = h.addProject("/w/use-stock", ["a", "b"]);
    const other = h.addProject("/w/use-design", ["c"]);

    const res = await h.run("project-delete", "/w/use-stock", "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Deleted /w/use-stock (2 sessions)");
    expect(existsSync(path)).toBe(false);
    expect(existsSync(other.path)).toBe(true);
  });

  it("resets the project's trust entry and preserves other config", async () => {
    const h = setup({
      config: {
        numStartups: 9,
        projects: {
          "/w/use-stock": {
            hasTrustDialogAccepted: true,
            allowedTools: ["Read"],
          },
          "/w/use-design": { hasTrustDialogAccepted: true },
        },
      },
    });
    h.addProject("/w/use-stock", ["a", "b"]);

    const res = await h.run("project-delete", "/w/use-stock", "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Reset trust config for /w/use-stock");

    const config = h.readConfig();
    expect(config.projects["/w/use-stock"]).toBeUndefined();
    expect(config.projects["/w/use-design"]).toEqual({
      hasTrustDialogAccepted: true,
    });
    expect(config.numStartups).toBe(9);
  });

  it("--keep-config preserves the trust entry", async () => {
    const h = setup({
      config: {
        projects: {
          "/w": { hasTrustDialogAccepted: true },
          "/w/use-stock": { hasTrustDialogAccepted: true },
        },
      },
    });
    h.addProject("/w/use-stock", ["a"]);

    const res = await h.run("project-delete", "/w/use-stock", "--yes", "--keep-config");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Kept Claude Code trust config");
    expect(h.readConfig().projects["/w/use-stock"]).toEqual({
      hasTrustDialogAccepted: true,
    });
    expect(h.readConfig().projects["/w"]).toEqual({
      hasTrustDialogAccepted: true,
    });
  });

  it("accepts a unique workspace-path suffix", async () => {
    const h = setup();
    const { path } = h.addProject("/Volumes/GoldenSnake/git/use-stock", ["a"]);

    const res = await h.run("project-delete", "git/use-stock", "--yes");

    expect(res.code).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses while a live session runs there, unless --force", async () => {
    const h = setup();
    const { path } = h.addProject("/w/alpha", ["a"]);
    h.addSession("alpha", "/w/alpha");

    const blocked = await h.run("project-delete", "/w/alpha", "--yes");
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("1 active session");
    expect(existsSync(path)).toBe(true);

    const forced = await h.run("project-delete", "/w/alpha", "--yes", "--force");
    expect(forced.code).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(forced.out).toContain("may restore its config entry");
  });

  it("--dry-run reports both deletions without changing anything", async () => {
    const h = setup({
      config: {
        projects: {
          "/w": { hasTrustDialogAccepted: true },
          "/w/alpha": { hasTrustDialogAccepted: true },
        },
      },
    });
    const { path } = h.addProject("/w/alpha", ["a"]);
    h.addSession("alpha", "/w/alpha");

    const res = await h.run("project-delete", "/w/alpha", "--dry-run");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Would delete /w/alpha (1 session)");
    expect(res.out).toContain("Would reset trust config for /w/alpha");
    expect(res.out).toContain("Would clear inherited trust for /w");
    expect(res.out).toContain("--force would be required");
    expect(existsSync(path)).toBe(true);
    expect(h.readConfig().projects["/w/alpha"]).toBeDefined();
    expect(h.readConfig().projects["/w"]).toEqual({
      hasTrustDialogAccepted: true,
    });
  });

  it("resets trust under the git root for a folder inside a repository", async () => {
    const h = setup();
    const repo = join(h.home, "repo");
    const sub = join(repo, "packages", "app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    h.addProject(sub, ["a"]);
    h.writeConfig({
      projects: { [realpathSync(repo)]: { hasTrustDialogAccepted: true } },
    });

    const res = await h.run("project-delete", sub, "--yes");

    expect(res.code).toBe(0);
    expect(h.readConfig().projects[realpathSync(repo)]).toBeUndefined();
  });

  it("writes through a symlinked ~/.claude.json without replacing the link", async () => {
    const h = setup({ config: null });
    const realConfig = join(h.home, "real-config.json");
    writeFileSync(
      realConfig,
      JSON.stringify({
        projects: { "/w/alpha": { hasTrustDialogAccepted: true } },
      }),
    );
    symlinkSync(realConfig, h.configPath);
    h.addProject("/w/alpha", ["a"]);

    const res = await h.run("project-delete", "/w/alpha", "--yes");

    expect(res.code).toBe(0);
    expect(lstatSync(h.configPath).isSymbolicLink()).toBe(true);
    expect(h.readConfig(realConfig).projects["/w/alpha"]).toBeUndefined();
  });

  it("resets an existing folder whose transcripts are already gone", async () => {
    const h = setup();
    const folder = join(h.home, "already-deleted");
    mkdirSync(folder);
    const root = realpathSync(h.home);
    const cwd = realpathSync(folder);
    h.writeConfig({
      projects: {
        [root]: { hasTrustDialogAccepted: true },
        [cwd]: { hasTrustDialogAccepted: true },
      },
    });

    const res = await h.run("project-delete", folder, "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("(0 sessions)");
    expect(res.out).toContain(`Cleared inherited trust for ${root}`);
    const config = h.readConfig();
    expect(config.projects[cwd]).toBeUndefined();
    expect(config.projects[root]).toEqual({ hasTrustDialogAccepted: false });
  });

  it("clears inherited trust on ancestors so the prompt returns", async () => {
    const h = setup({
      config: {
        projects: {
          "/w": { hasTrustDialogAccepted: true, allowedTools: ["Read"] },
          "/w/alpha": { hasTrustDialogAccepted: true },
        },
      },
    });
    h.addProject("/w/alpha", ["a"]);

    const res = await h.run("project-delete", "/w/alpha", "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Cleared inherited trust for /w");

    const config = h.readConfig();
    expect(config.projects["/w/alpha"]).toBeUndefined();
    expect(config.projects["/w"]).toEqual({
      hasTrustDialogAccepted: false,
      allowedTools: ["Read"],
    });
  });

  it("deletes without a config file", async () => {
    const h = setup({ config: null });
    const { path } = h.addProject("/w/alpha", ["a"]);

    const res = await h.run("project-delete", "/w/alpha", "--yes");

    expect(res.code).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(res.out).toContain("No Claude Code trust config entry to reset");
  });

  it("reports an unknown target and lists alternatives", async () => {
    const h = setup();
    h.addProject("/w/alpha", ["a"]);

    const res = await h.run("project-delete", "nope", "--yes");

    expect(res.code).toBe(1);
    expect(res.err).toContain('No project matches "nope"');
    expect(res.err).toContain("use-code-cli projects");
  });

  it("refuses an ambiguous basename and names the candidates", async () => {
    const h = setup();
    h.addProject("/w/a/app", ["a"]);
    h.addProject("/w/b/app", ["b"]);

    const res = await h.run("project-delete", "app", "--yes");

    expect(res.code).toBe(1);
    expect(res.err).toContain("ambiguous");
    expect(res.err).toContain("/w/a/app");
    expect(res.err).toContain("/w/b/app");
  });
});
