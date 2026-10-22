import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * A throwaway HOME holding one fake ~/.claude/sessions tree plus a unix socket
 * that stands in for a session's messaging socket. Each fake session is backed
 * by a live `sleep`, because liveSessions() checks the pid is alive.
 */
function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const socketPath = join(home, "s");
  let received = "";
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(_socket, chunk) {
        received += Buffer.from(chunk).toString();
      },
    },
  });

  const sleeps: Bun.Subprocess[] = [];
  cleanups.push(() => {
    server.stop(true);
    for (const p of sleeps) p.kill();
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Register a session file; without a pid, back it with a live `sleep`.
   * `socket` defaults to the harness listener, so a session pointed elsewhere
   * fails delivery — which tells the tests which session was picked.
   */
  function addSession(
    name: string,
    { pid, socket = socketPath }: { pid?: number; socket?: string } = {},
  ): void {
    if (pid === undefined) {
      const proc = Bun.spawn(["sleep", "30"]);
      sleeps.push(proc);
      pid = proc.pid;
    }
    writeFileSync(
      join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId: `session-${pid}`,
        name,
        cwd: home,
        messagingSocketPath: socket,
      }),
    );
    writeFileSync(
      join(sessionsDir, `${pid}.test.key`),
      JSON.stringify({ peerToken: "test-token" }),
    );
  }

  async function run(command: string, ...args: string[]) {
    const proc = Bun.spawn([process.execPath, CLI, command, ...args], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    // The socket server may drain the payload a tick after the CLI exits.
    for (let i = 0; i < 50 && received === "" && code === 0; i++) await Bun.sleep(10);
    return { code, out, err, received: () => received };
  }

  return { addSession, run };
}

describe("talk", () => {
  it("sends to the only active session when the target is omitted", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "hello worker");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("hello worker");
  });

  it("never auto-picks the session that launched the CLI", async () => {
    // The test runner is the CLI's parent, so a session at this pid is the
    // caller and must not compete with "worker" for the auto-pick.
    const h = setup();
    h.addSession("caller", { pid: process.pid, socket: "" });
    h.addSession("worker");

    const res = await h.run("talk", "hi");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("hi");
  });

  it("lists candidates when more than one session is active", async () => {
    const h = setup();
    h.addSession("alpha");
    h.addSession("beta");

    const res = await h.run("talk", "hi");

    expect(res.code).toBe(1);
    expect(res.err).toContain("2 active sessions");
    expect(res.received()).toBe("");
  });

  it("still accepts an explicit target", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "ping");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("ping");
  });

  it("requires a message when the lone argument names a session", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker");

    expect(res.code).toBe(1);
    expect(res.err).toContain("Message required");
    expect(res.received()).toBe("");
  });

  it("keeps the old say and send names as aliases", async () => {
    const h = setup();
    h.addSession("worker");

    const said = await h.run("say", "from say");
    const sent = await h.run("send", "from send");

    expect(said.code).toBe(0);
    expect(sent.code).toBe(0);
    expect(said.received()).toContain("from say");
    expect(sent.received()).toContain("from send");
  });
});
