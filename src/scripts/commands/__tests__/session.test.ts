import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** A throwaway HOME holding a fake ~/.claude/sessions tree. */
function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const sleeps: Bun.Subprocess[] = [];
  cleanups.push(() => {
    // SIGKILL also reaches a SIGSTOP'd process, which SIGTERM never would.
    for (const p of sleeps) p.kill("SIGKILL");
    rmSync(home, { recursive: true, force: true });
  });

  /** Register a live session, backed by a `sleep` so it counts as online. */
  function addSession(name: string, status: string, waitingFor?: string) {
    const proc = Bun.spawn(["sleep", "30"]);
    sleeps.push(proc);
    const sessionId = `session-${proc.pid}`;
    writeFileSync(
      join(sessionsDir, `${proc.pid}.json`),
      JSON.stringify({
        pid: proc.pid,
        sessionId,
        name,
        cwd: `/w/${name}`,
        status,
        ...(waitingFor !== undefined ? { waitingFor } : {}),
        startedAt: Date.now() - 60_000,
        updatedAt: Date.now(),
      }),
    );
    return { sessionId, pid: proc.pid };
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

  return { addSession, run };
}

describe("session command", () => {
  it("shows the waiting reason in the state row for a waiting session", async () => {
    const h = setup();
    h.addSession("alpha", "waiting", "permission prompt");

    const res = await h.run("session", "alpha");

    expect(res.code).toBe(0);
    expect(res.out).toContain("waiting — permission prompt · active");
  });

  it("includes waitingFor in --json data", async () => {
    const h = setup();
    h.addSession("alpha", "waiting", "permission prompt");

    const res = await h.run("session", "alpha", "--json");

    expect(res.code).toBe(0);
    const data = JSON.parse(res.out);
    expect(data.success).toBe(true);
    expect(data.data.waitingFor).toBe("permission prompt");
  });

  it("omits the waiting reason when the status is not waiting", async () => {
    const h = setup();
    h.addSession("alpha", "busy", "permission prompt");

    const res = await h.run("session", "alpha");

    expect(res.code).toBe(0);
    expect(res.out).toContain("busy · active");
    expect(res.out).not.toContain("permission prompt");
  });
});
