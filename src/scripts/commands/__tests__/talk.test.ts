import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  interface RunOptions {
    /** Text piped to the CLI's stdin; omit to inherit the test runner's. */
    stdin?: string;
  }

  async function run(command: string, ...rest: (string | RunOptions)[]) {
    const last = rest.at(-1);
    const options: RunOptions = typeof last === "object" ? (rest.pop() as RunOptions) : {};
    const proc = Bun.spawn([process.execPath, CLI, command, ...(rest as string[])], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
      stdin: options.stdin === undefined ? "inherit" : "pipe",
    });
    if (options.stdin !== undefined && proc.stdin) {
      proc.stdin.write(options.stdin);
      await proc.stdin.end();
    }
    const code = await proc.exited;
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    // The socket server may drain the payload a tick after the CLI exits.
    for (let i = 0; i < 50 && received === "" && code === 0; i++) await Bun.sleep(10);
    return { code, out, err, received: () => received };
  }

  return { addSession, run, home };
}

/** Poll until `predicate` holds or the budget runs out (socket drain is async). */
async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await Bun.sleep(10);
  }
  return predicate();
}

/**
 * The message text from the last payload the socket received. The socket sees
 * the wire JSON, where a quoted placeholder arrives escaped — decode it to
 * assert on what the peer's agent actually reads.
 */
function lastContent(raw: string): string {
  const line = raw.split("\n").filter(Boolean).at(-1) ?? "";
  try {
    return (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? "";
  } catch {
    return "";
  }
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

  it("sends plain text without nesting a cross-session-message envelope", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "ping");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("ping");
    // Claude Code adds the real from-name envelope on arrival; a second one
    // here would misattribute the message to this CLI.
    expect(res.received()).not.toContain("<cross-session-message");
  });

  it("strips an envelope the caller includes", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run(
      "talk",
      "worker",
      '<cross-session-message from-name="x">hi</cross-session-message>',
    );

    expect(res.code).toBe(0);
    expect(res.received()).toContain("hi");
    expect(res.received()).not.toContain("</cross-session-message");
  });

  it("appends a reply instruction naming the caller session by default", async () => {
    const h = setup();
    // The test runner is the CLI's parent, so this session is the sender.
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("talk", "worker", "run the tests");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("run the tests");
    expect(lastContent(res.received())).toContain(
      "When you're done, report back with use-code-cli talk caller \"<your answer>\" --no-reply",
    );
  });

  it("marks the message with the msg_id it reports", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("talk", "worker", "run the tests");
    const msgId = /msg_id=([0-9a-f-]{36})/.exec(res.out)?.[1];

    expect(msgId).toBeDefined();
    expect(res.received()).toContain(
      `<!-- use-code-cli:auto-reply hop=1 id=${msgId} -->`,
    );
  });

  it("never annotates an automatic reply", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run(
      "talk",
      "worker",
      "Done.\n<!-- use-code-cli:auto-reply hop=1 id=abc -->",
    );

    expect(res.code).toBe(0);
    expect(res.received()).toContain("Done.");
    expect(res.received()).not.toContain("report back with");
    expect(res.out).toContain("looks like an automatic reply");
  });

  it("answers a message by id, and refuses to answer it twice", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const first = await h.run("talk", "worker", "done", "--in-reply-to", "in-1");
    expect(first.code).toBe(0);
    expect(first.received()).toContain("re=in-1");

    const second = await h.run("talk", "worker", "done again", "--in-reply-to", "in-1");
    expect(second.code).toBe(1);
    expect(second.err).toContain("Already replied to msg_id=in-1");
    expect(await waitFor(() => second.received().includes("done again"))).toBe(false);
  });

  it("sends again with --force", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    await h.run("talk", "worker", "done", "--in-reply-to", "in-1");
    const forced = await h.run(
      "talk",
      "worker",
      "done again",
      "--in-reply-to",
      "in-1",
      "--force",
    );

    expect(forced.code).toBe(0);
    expect(await waitFor(() => forced.received().includes("done again"))).toBe(true);
  });

  it("sends the message untouched with --no-reply", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("talk", "worker", "FYI only", "--no-reply");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("FYI only");
    expect(res.received()).not.toContain("report back with");
  });

  it("skips the reply instruction and says so when the sender is unknown", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "ping");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("ping");
    expect(res.received()).not.toContain("report back with");
    expect(res.out).toContain("could not determine the sender session");
  });

  it("does not append a second reply instruction", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run(
      "talk",
      "worker",
      "run the tests. When you're done, report back with use-code-cli talk someone --no-reply",
    );

    expect(res.code).toBe(0);
    expect(res.received().split("report back with").length - 1).toBe(1);
    expect(res.received()).toContain("use-code-cli talk someone");
    expect(res.received()).not.toContain("use-code-cli talk caller");
  });

  it("still annotates a message that merely mentions the command", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("talk", "worker", "the log shows use-code-cli talk worker failed");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("report back with use-code-cli talk caller");
  });
});

describe("talk — automatic-reply default", () => {
  /** Pretend this session just received an automatic reply. */
  function seedInbound(h: ReturnType<typeof setup>, sessionId: string) {
    const dir = join(h.home, ".use-code-cli");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "talk-inbound.json"),
      JSON.stringify([{ sessionId, at: Date.now() }]),
    );
  }

  it("marks the receiving session when it delivers an annotated message", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    await h.run("talk", "worker", "please run the tests");

    const marks = JSON.parse(
      readFileSync(join(h.home, ".use-code-cli", "talk-inbound.json"), "utf8"),
    ) as { sessionId: string }[];
    expect(marks.some((m) => m.sessionId.startsWith("session-"))).toBe(true);
  });

  it("suppresses the instruction by default after receiving an automatic reply", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");
    seedInbound(h, `session-${process.pid}`);

    const res = await h.run("talk", "worker", "done");

    expect(res.code).toBe(0);
    expect(res.received()).not.toContain("report back with");
    expect(res.out).toContain("received an automatic reply");
  });

  it("--reply overrides the conservative default", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");
    seedInbound(h, `session-${process.pid}`);

    const res = await h.run("talk", "worker", "done", "--reply");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("report back with use-code-cli talk caller");
  });

  it("clears the mark once the session answers", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");
    seedInbound(h, `session-${process.pid}`);

    await h.run("talk", "worker", "done");
    const res = await h.run("talk", "worker", "next task");

    expect(res.received()).toContain("report back with use-code-cli talk caller");
  });
});

describe("talk — --- message separator", () => {
  it("takes every token after the first --- as the message", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "---", "hello", "world");

    expect(res.code).toBe(0);
    expect(lastContent(res.received())).toContain("hello world");
  });

  it("keeps flags after --- as literal text", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("talk", "worker", "---", "keep", "--no-reply");
    const content = lastContent(res.received());

    expect(content).toContain("keep --no-reply");
    // The literal --no-reply did not disable the instruction.
    expect(content).toContain("report back with use-code-cli talk caller");
  });

  it("still honours flags before ---", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("talk", "worker", "--no-reply", "---", "hi");

    expect(res.code).toBe(0);
    expect(lastContent(res.received())).toContain("hi");
    expect(lastContent(res.received())).not.toContain("report back with");
  });

  it("treats a later --- as message text", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "---", "a", "---", "b");

    expect(lastContent(res.received())).toContain("a --- b");
  });

  it("auto-picks the session when the target is omitted", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "---", "hello");

    expect(res.code).toBe(0);
    expect(lastContent(res.received())).toContain("hello");
  });

  it("reads the message from stdin when nothing follows ---", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "---", { stdin: "line one\nline two\n" });

    expect(res.code).toBe(0);
    expect(lastContent(res.received())).toContain("line one\nline two");
  });

  it("errors clearly when --- has no message and stdin is empty", async () => {
    const h = setup();
    h.addSession("worker");

    const res = await h.run("talk", "worker", "---", { stdin: "" });

    expect(res.code).toBe(1);
    expect(res.err).toContain("Message required after ---");
    expect(res.received()).toBe("");
  });
});
