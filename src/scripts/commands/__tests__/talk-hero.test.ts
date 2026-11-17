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
 * A throwaway HOME holding one fake ~/.claude/sessions tree, a unix socket
 * standing in for the target session's messaging socket, and a transcript
 * whose Deploy call names the hero — what readTranscriptMeta matches on.
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
   * Register a live session deployed as `hero`, backed by a `sleep`. The cwd's
   * basename must match the CLI's project (basename of its cwd), so the fake
   * workspace lives inside the throwaway HOME under that name.
   */
  function addSession(hero: string): void {
    const proc = Bun.spawn(["sleep", "30"]);
    sleeps.push(proc);
    const pid = proc.pid;
    const sessionId = `session-${pid}`;
    const cwd = join(home, "use-code-cli");
    writeFileSync(
      join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId,
        name: hero.toLowerCase(),
        cwd,
        messagingSocketPath: socketPath,
      }),
    );
    writeFileSync(
      join(sessionsDir, `${pid}.test.key`),
      JSON.stringify({ peerToken: "test-token" }),
    );

    const projectDir = join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(projectDir, { recursive: true });
    const deployLine = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "mcp__Counter___Counter__Deploy",
            input: { callSign: hero },
          },
        ],
      },
    });
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${deployLine}\n`);
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

  return { addSession, run };
}

/** The message text from the last payload the socket received (wire JSON). */
function lastContent(raw: string): string {
  const line = raw.split("\n").filter(Boolean).at(-1) ?? "";
  try {
    return (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? "";
  } catch {
    return "";
  }
}

describe("talk-hero", () => {
  it("sends an argument message to the session whose hero matches", async () => {
    const h = setup();
    h.addSession("JAMES");

    const res = await h.run("talk-hero", "james", "status?");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("status?");
  });

  it("reads the message from piped stdin when the argument is omitted", async () => {
    const h = setup();
    h.addSession("JAMES");

    const res = await h.run("talk-hero", "JAMES", { stdin: "hello via pipe\n" });

    expect(res.code).toBe(0);
    expect(res.received()).toContain("hello via pipe");
  });

  it("errors when piped stdin is empty", async () => {
    const h = setup();
    h.addSession("JAMES");

    const res = await h.run("talk-hero", "JAMES", { stdin: "" });

    expect(res.code).toBe(1);
    expect(res.err).toContain("Message required");
    expect(res.received()).toBe("");
  });

  it("prefers the message argument over piped stdin", async () => {
    const h = setup();
    h.addSession("JAMES");

    const res = await h.run("talk-hero", "JAMES", "arg message", { stdin: "piped message" });

    expect(res.code).toBe(0);
    expect(lastContent(res.received())).toContain("arg message");
    expect(lastContent(res.received())).not.toContain("piped message");
  });

  it("passes multiline stdin content verbatim", async () => {
    const h = setup();
    h.addSession("JAMES");

    const res = await h.run(
      "talk-hero",
      "JAMES",
      "--one-way",
      { stdin: "line one\n中文行\n`backtick`\n" },
    );

    expect(res.code).toBe(0);
    expect(lastContent(res.received())).toContain("line one\n中文行\n`backtick`");
  });

  it("still requires a message when stdin is a terminal", async () => {
    const h = setup();
    h.addSession("JAMES");

    // Inherited stdin: a TTY in interactive runs, so there is nothing to read.
    const res = await h.run("talk-hero", "JAMES");

    expect(res.code).toBe(1);
    expect(res.err).toContain("Message required");
    expect(res.received()).toBe("");
  });
});
