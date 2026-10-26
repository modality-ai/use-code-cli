import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
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

/** A throwaway HOME holding a fake ~/.claude tree. */
function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  const projectsDir = join(home, ".claude", "projects");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  const sleeps: Bun.Subprocess[] = [];
  cleanups.push(() => {
    for (const p of sleeps) p.kill();
    rmSync(home, { recursive: true, force: true });
  });

  /** Write one project directory with a transcript per session id. */
  function addProject(cwd: string, sessionIds: string[], updatedAt = Date.now()) {
    const dir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const path = join(projectsDir, dir);
    mkdirSync(path, { recursive: true });
    for (const id of sessionIds) {
      const file = join(path, `${id}.jsonl`);
      writeFileSync(file, JSON.stringify({ cwd, type: "summary" }) + "\n");
      utimesSync(file, updatedAt / 1000, updatedAt / 1000);
    }
    return { dir, path };
  }

  /** Register a live session backed by a `sleep` so it counts as active. */
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

  return { addProject, addSession, run };
}

describe("projects", () => {
  it("lists each project with its session count", async () => {
    const h = setup();
    h.addProject("/w/use-design", ["a", "b"]);
    h.addProject("/w/use-stock", ["c"]);

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/use-design");
    expect(res.out).toContain("2 sessions");
    expect(res.out).toContain("/w/use-stock");
    expect(res.out).toContain("1 session");
  });

  it("decodes the workspace path from the transcript, not the lossy directory name", async () => {
    const h = setup();
    h.addProject("/Users/a/my.app", ["a"]);

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/Users/a/my.app");
  });

  it("counts live sessions as active", async () => {
    const h = setup();
    h.addProject("/w/alpha", ["s1"]);
    h.addSession("alpha", "/w/alpha");

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/alpha  1 session  1 active");
  });

  it("sorts projects by newest activity first", async () => {
    const h = setup();
    const now = Date.now();
    h.addProject("/w/older", ["a"], now - 60_000);
    h.addProject("/w/newer", ["b"], now);

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out.indexOf("/w/newer")).toBeLessThan(res.out.indexOf("/w/older"));
  });

  it("reports when there are no projects", async () => {
    const h = setup();

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("No projects found");
  });

  it("exposes structured rows with --json", async () => {
    const h = setup();
    h.addProject("/w/alpha", ["a", "b"]);

    const res = await h.run("projects", "--json");
    const payload = JSON.parse(res.out);

    expect(res.code).toBe(0);
    expect(payload.success).toBe(true);
    expect(payload.data[0]).toMatchObject({
      cwd: "/w/alpha",
      sessions: 2,
      active: 0,
    });
  });
});
