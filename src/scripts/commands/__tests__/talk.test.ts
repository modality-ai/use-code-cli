import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { talkCommand } from "../talk";
import type { TalkArgs, TalkDeps } from "../talk";
import { sendWithReply } from "../../../lib/reply-send";
import { sessionLabel as label } from "../../../lib/sessions";

const cleanups: (() => void)[] = [];
let received = "";

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function normalizeStdin(text: string): string | undefined {
  const stripped = text.replace(/\r?\n$/, "");
  return stripped.trim() === "" ? undefined : stripped;
}

async function writeToSocket(path: string, payload: string): Promise<void> {
  received += payload;
  return Promise.resolve();
}

function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const socketPath = join(home, "s");
  received = "";
  const server = { stop() {} };

  const sessions: any[] = [];
  const replyLedger = new Map<string, any>();

  const deliverMock = async (session: any, body: string, msgId?: string) => {
    const id = msgId ?? randomUUID();
    const stripped = body.replace(/<\/?cross-session-message[^>]*>/g, "").trim();
    const msg = { msgV: 1, msg_id: id, type: "user", message: { role: "user", content: stripped }, priority: "next" };
    await writeToSocket(session.messagingSocketPath, JSON.stringify(msg) + "\n");
    return id;
  };

  const sendWithReplyFn = (args: any) =>
    sendWithReply({
      ...args,
      deps: {
        currentSession: async (sessionsArg: any[]) => (sessionsArg ?? []).find((s: any) => s.pid === process.pid),
        liveSessions: async () => sessions,
        deliver: deliverMock,
        findReply: async (inReplyTo: string, targetSessionId: string) =>
          replyLedger.get(`${targetSessionId}\u0000${inReplyTo}`),
        recordReply: async (record: any) => {
          replyLedger.set(`${record.targetSessionId}\u0000${record.inReplyTo}`, record);
        },
        label,
      },
    });

  let stdinValue: string | undefined;
  let ancestorSet = new Set<number>([process.pid]);

  const deps: TalkDeps = {
    liveSessions: async () => sessions,
    ancestorPids: () => ancestorSet,
    readStdinMessageOrUndefined: async () => stdinValue,
    sendWithReply: sendWithReplyFn,
    label,
  };

  function addSession(
    name: string,
    { pid, socket = socketPath, status }: { pid?: number; socket?: string; status?: string } = {},
  ): void {
    const p = pid === undefined ? 1000 + sessions.length + 1 : pid;
    sessions.push({
      pid: p,
      sessionId: `session-${p}`,
      name,
      cwd: home,
      messagingSocketPath: socket,
      ...(status === undefined ? {} : { status }),
    });
  }

  async function run(...rest: any[]) {
    // parse trailing RunOptions
    const last = rest.at(-1);
    const options = typeof last === "object" && last !== null && !Array.isArray(last) && ("stdin" in last || "args" in last) ? (rest.pop() as any) : {};
    const argv = rest as string[];
    const opts = options ?? {};

    if (opts.stdin !== undefined) {
      stdinValue = normalizeStdin(opts.stdin);
    } else {
      stdinValue = undefined;
    }

    // Handle --- separator like preprocessTalkArgv
    const sepIndex = argv.indexOf("---", 1);
    let talkArgs: TalkArgs = {};
    if (sepIndex !== -1) {
      const before = argv.slice(0, sepIndex);
      const tokens = argv.slice(sepIndex + 1);
      let message: string | undefined;
      if (tokens.length === 0) {
        // read from stdin
        const stdin = opts.stdin !== undefined ? opts.stdin : undefined;
        const stripped = stdin !== undefined ? stdin.replace(/\r?\n$/, "") : undefined;
        if (stripped === undefined || stripped.trim() === "") {
          // error
          return { code: 1, out: "", err: "Message required after ---", received: () => received };
        }
        message = stripped;
      } else {
        message = tokens.join(" ");
      }
      if (message.trim() === "") {
        return { code: 1, out: "", err: "Message required after ---: nothing was supplied.", received: () => received };
      }
      // parse flags from before
      const flags = parseFlags(before);
      const positionals = before.filter((t) => !t.startsWith("--"));
      talkArgs = {
        ...flags,
        ...(positionals[0] !== undefined ? { target: positionals[0] } : {}),
        message,
      };
    } else {
      const flags = parseFlags(argv);
      const positionals = argv.filter((t) => !t.startsWith("--") && !t.startsWith("--in-reply-to=") );
      // handle --in-reply-to value already consumed in parseFlags
      talkArgs = {
        ...flags,
        ...(positionals[0] !== undefined ? { target: positionals[0] } : {}),
        ...(positionals[1] !== undefined ? { message: positionals[1] } : {}),
      };
    }

    // wait socket drain helper
    const res = await talkCommand.create(deps)(talkArgs);
    return { code: res.success ? 0 : 1, out: res.message, err: res.success ? "" : res.message, received: () => received };
  }

  cleanups.push(() => {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  return { addSession, run, home, socketPath, sessions, received: () => received };
}

function parseFlags(tokens: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--one-way") out["one-way"] = true;
    else if (t === "--force") out.force = true;
    else if (t === "--self") out.self = true;
    else if (t === "--in-reply-to") { out["in-reply-to"] = tokens[++i]; }
    else if (t.startsWith("--in-reply-to=")) { out["in-reply-to"] = t.slice("--in-reply-to=".length); }
    else if (t === "--filter-name") { out["filter-name"] = tokens[++i]; }
    else if (t === "--filter-status") { out["filter-status"] = tokens[++i]; }
    else if (t === "--filter-hero") { out["filter-hero"] = tokens[++i]; }
  }
  return out;
}

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

    const res = await h.run("hello worker");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("hello worker");
  });
  it("never auto-picks the session that launched the CLI", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("hi");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("hi");
  });
  it("appends a reply instruction naming the caller session by default", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("worker", "run the tests");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("run the tests");
    expect(lastContent(res.received())).toMatch(
      /When you're done, report back with `!use-code-cli talk caller "<your answer>" --in-reply-to [0-9a-f-]{36} --one-way`/,
    );
  });
  it("never annotates an automatic reply", async () => {
    const h = setup();
    h.addSession("caller", { pid: process.pid });
    h.addSession("worker");

    const res = await h.run("worker", "Done.\n<!-- use-code-cli:auto-reply hop=1 id=abc -->");

    expect(res.code).toBe(0);
    expect(res.received()).toContain("Done.");
    expect(res.received()).not.toContain("report back with");
    expect(res.out).toContain("looks like an automatic reply");
  });
});
