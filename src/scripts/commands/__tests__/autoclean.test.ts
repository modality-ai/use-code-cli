import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  const projectsDir = join(home, ".claude", "projects");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  const configPath = join(home, ".claude.json");
  writeFileSync(configPath, JSON.stringify({ projects: {} }, null, 2));

  const sleeps: Bun.Subprocess[] = [];
  cleanups.push(() => {
    for (const p of sleeps) p.kill();
    rmSync(home, { recursive: true, force: true });
  });

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
    return proc.pid;
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

  return { home, sessionsDir, projectsDir, addProject, addSession, run };
}

describe("autoclean", () => {
  it("refuses without --yes when sessions would be deleted", async () => {
    const h = setup();
    h.addProject("/w/proj", ["a", "b", "c", "d", "e"]);

    const res = await h.run("autoclean", "2", "--project", "/w/proj");

    expect(res.code).toBe(1);
    expect(res.code).toBe(1);
    expect(res.err + res.out).toContain("Re-run with --yes");
    // files untouched
    expect(existsSync(join(h.projectsDir, "/w/proj".replace(/[^a-zA-Z0-9]/g, "-"), "a.jsonl"))).toBe(true);
  });

  it("deletes excess sessions with --yes", async () => {
    const h = setup();
    const { path } = h.addProject("/w/proj", ["a", "b", "c", "d", "e"]);

    const res = await h.run("autoclean", "2", "--project", "/w/proj", "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Deleted 3 session(s)");
    // only 2 transcripts remain
    const remaining = (await (async () => {
      const { readdirSync } = await import("node:fs");
      return readdirSync(path).filter((f: string) => f.endsWith(".jsonl"));
    })());
    expect(remaining.length).toBe(2);
  });

  it("--dry-run reports without deleting", async () => {
    const h = setup();
    const { path } = h.addProject("/w/proj", ["a", "b", "c", "d", "e"]);

    const res = await h.run("autoclean", "2", "--project", "/w/proj", "--dry-run");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Dry run");
    const remaining = (await (async () => {
      const { readdirSync } = await import("node:fs");
      return readdirSync(path).filter((f: string) => f.endsWith(".jsonl"));
    })());
    expect(remaining.length).toBe(5);
  });

  it("never deletes active sessions", async () => {
    const h = setup();
    h.addProject("/w/proj", ["a", "b"]);
    const pid = h.addSession("alpha", "/w/proj");

    // keep=1 but one active session already fills the slot → nothing to clean
    const res = await h.run("autoclean", "1", "--project", "/w/proj", "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("already reach the keep limit");
  });

  it("reports nothing to clean when sessions fit", async () => {
    const h = setup();
    h.addProject("/w/proj", ["a", "b"]);

    const res = await h.run("autoclean", "50", "--project", "/w/proj", "--yes");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Nothing to clean");
  });

  it("errors on unknown project", async () => {
    const h = setup();

    const res = await h.run("autoclean", "5", "--project", "/no/such/project", "--yes");

    expect(res.code).toBe(1);
    expect(res.err + res.out).toContain("No project matches");
  });
});