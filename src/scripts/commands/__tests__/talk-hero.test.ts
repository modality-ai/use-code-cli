import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { talkHero } from "../../../lib/talk-hero-command";

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const socketPath = join(home, "s");
  let received = "";
  const sessionsDir = join(homedir(), ".claude", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, "12345.test.key"), JSON.stringify({ peerToken: "test-token" }));
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(_socket, chunk) {
        received += Buffer.from(chunk).toString();
      },
    },
  });

  cleanups.push(() => {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  const sessionId = "session-1";
  const cwd = join(home, "use-code-cli");
  mkdirSync(join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });

  const session = {
    pid: 12345,
    sessionId,
    name: "JAMES",
    cwd,
    online: true,
    messagingSocketPath: socketPath,
  };

  function lastContent(raw: string): string {
    const line = raw.split("\n").filter(Boolean).at(-1) ?? "";
    try {
      return (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? "";
    } catch {
      return "";
    }
  }

  return { home, socketPath, session, received: () => received, lastContent };
}

function makeArgs(extra: Record<string, unknown> = {}) {
  return { hero: "JAMES", ...extra } as any;
}

describe("talk-hero", () => {
  it("sends an argument message to the session whose hero matches", async () => {
    const h = setup();
    const res = await talkHero(makeArgs({ message: "status?" }), {
      readSessions: async () => [h.session as any],
      readTranscriptMeta: async () => ({ hero: "JAMES" }),
      cwd: () => h.session.cwd,
      readStdinMessageOrUndefined: async () => undefined,
    });
    await Bun.sleep(1);
    expect(res.success).toBe(true);
    expect(h.received()).toContain("status?");
  });

  it("reads the message from piped stdin when the argument is omitted", async () => {
    const h = setup();
    const res = await talkHero(makeArgs({}), {
      readSessions: async () => [h.session as any],
      readTranscriptMeta: async () => ({ hero: "JAMES" }),
      cwd: () => h.session.cwd,
      readStdinMessageOrUndefined: async () => "hello via pipe\n",
    });
    await Bun.sleep(1);
    expect(res.success).toBe(true);
    expect(h.received()).toContain("hello via pipe");
  });

  it("errors when piped stdin is empty", async () => {
    const h = setup();
    const res = await talkHero(makeArgs({}), {
      readSessions: async () => [h.session as any],
      readTranscriptMeta: async () => ({ hero: "JAMES" }),
      cwd: () => h.session.cwd,
      readStdinMessageOrUndefined: async () => undefined,
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Message required");
    expect(h.received()).toBe("");
  });

  it("prefers the message argument over piped stdin", async () => {
    const h = setup();
    const res = await talkHero(makeArgs({ message: "arg message" }), {
      readSessions: async () => [h.session as any],
      readTranscriptMeta: async () => ({ hero: "JAMES" }),
      cwd: () => h.session.cwd,
      readStdinMessageOrUndefined: async () => "piped message",
    });
    await Bun.sleep(1);
    expect(res.success).toBe(true);
    expect(h.lastContent(h.received())).toContain("arg message");
    expect(h.lastContent(h.received())).not.toContain("piped message");
  });

  it("passes multiline stdin content verbatim", async () => {
    const h = setup();
    const res = await talkHero(makeArgs({ "one-way": true }), {
      readSessions: async () => [h.session as any],
      readTranscriptMeta: async () => ({ hero: "JAMES" }),
      cwd: () => h.session.cwd,
      readStdinMessageOrUndefined: async () => "line one\n中文行\n`backtick`\n",
    });
    await Bun.sleep(1);
    expect(res.success).toBe(true);
    expect(h.lastContent(h.received())).toContain("line one\n中文行\n`backtick`");
  });

  it("still requires a message when stdin is a terminal", async () => {
    const h = setup();
    const res = await talkHero(makeArgs({}), {
      readSessions: async () => [h.session as any],
      readTranscriptMeta: async () => ({ hero: "JAMES" }),
      cwd: () => h.session.cwd,
      readStdinMessageOrUndefined: async () => undefined,
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Message required");
    expect(h.received()).toBe("");
  });
});
