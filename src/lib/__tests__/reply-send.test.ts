import { describe, expect, it } from "bun:test";
import { sendWithReply } from "../reply-send";
import type { LiveSession } from "../peer";

const session: LiveSession = {
  pid: 42,
  sessionId: "target-session",
  name: "james",
  cwd: "/tmp/proj",
  messagingSocketPath: "/tmp/s",
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const delivered: { body: string; msgId: string }[] = [];
  const recorded: unknown[] = [];
  const deps = {
    findReply: async () => undefined,
    recordReply: async (r: unknown) => { recorded.push(r); },
    cleanRepliesForSender: async () => 0,
    currentSession: async () => ({ pid: 7, sessionId: "sender-session", name: "sender", cwd: "/tmp/proj" } as LiveSession),
    liveSessions: async () => [],
    deliver: async (_s: LiveSession, body: string, msgId: string) => {
      delivered.push({ body, msgId });
      return msgId;
    },
    interrupt: async () => "interrupted",
    label: (s: LiveSession) => s.name ?? `pid-${s.pid}`,
    ...overrides,
  };
  return { deps, delivered, recorded };
}

describe("sendWithReply", () => {
  it("blocks a duplicate reply unless --force", async () => {
    const previous = { at: 1234567890, msgId: "prev-msg" };
    const { deps } = makeDeps({ findReply: async () => previous });
    const res = await sendWithReply({ session, message: "hi", inReplyTo: "msg-1", deps });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Already replied");
  });

  it("sends when --force bypasses the ledger", async () => {
    const previous = { at: 1234567890, msgId: "prev-msg" };
    const { deps, delivered } = makeDeps({ findReply: async () => previous });
    const res = await sendWithReply({ session, message: "hi", inReplyTo: "msg-1", force: true, deps });
    expect(res.success).toBe(true);
    expect(delivered).toHaveLength(1);
  });

  it("disables the reply instruction with --one-way", async () => {
    const { deps, delivered } = makeDeps();
    const res = await sendWithReply({ session, message: "hi", oneWay: true, deps });
    expect(res.success).toBe(true);
    expect((res.data as any).replyHint).toBe("disabled");
    expect(delivered[0]!.body).toBe("hi");
  });

  it("skips the instruction and notes when there is no sender", async () => {
    const { deps, delivered } = makeDeps({ currentSession: async () => undefined });
    const res = await sendWithReply({ session, message: "hi", deps });
    expect(res.success).toBe(true);
    expect((res.data as any).replyHint).toBe("skipped-no-sender");
    expect(delivered[0]!.body).toBe("hi");
    expect(res.message).toContain("could not determine the sender session");
  });

  it("marks an already-instructed message as already-present", async () => {
    const { deps, delivered } = makeDeps();
    const msg = "do x\nuse-code-cli talk foo \"y\" --one-way";
    const res = await sendWithReply({ session, message: msg, deps });
    expect(res.success).toBe(true);
    expect((res.data as any).replyHint).toBe("already-present");
    expect(delivered[0]!.body).toBe(msg);
  });

  it("treats an auto-reply as auto-reply and notes it", async () => {
    const { deps, delivered } = makeDeps();
    // hop=MAX_REPLY_HOP marker makes isAutoReply true
    const marker = "<!-- use-code-cli:auto-reply hop=999 -->";
    const msg = `answer ${marker}`;
    const res = await sendWithReply({ session, message: msg, deps });
    expect(res.success).toBe(true);
    expect((res.data as any).replyHint).toBe("auto-reply");
    expect(delivered[0]!.body).toBe(msg);
    expect(res.message).toContain("automatic reply");
  });

  it("appends the reply instruction to a plain message", async () => {
    const { deps, delivered } = makeDeps();
    const res = await sendWithReply({ session, message: "please do X", deps });
    expect(res.success).toBe(true);
    expect((res.data as any).replyHint).toBe("appended");
    expect(delivered[0]!.body).toContain("please do X");
    expect(delivered[0]!.body).toContain("use-code-cli talk");
    expect(delivered[0]!.body).toContain("--one-way");
  });

  it("does not record the reply when --one-way even with --in-reply-to", async () => {
    const { deps, recorded } = makeDeps();
    const res = await sendWithReply({ session, message: "hi", inReplyTo: "msg-1", oneWay: true, deps });
    expect(res.success).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  it("records the reply in the ledger on --in-reply-to", async () => {
    const { deps, recorded } = makeDeps();
    const res = await sendWithReply({ session, message: "hi", inReplyTo: "msg-1", deps });
    expect(res.success).toBe(true);
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as any).inReplyTo).toBe("msg-1");
    expect((recorded[0] as any).targetSessionId).toBe(session.sessionId);
  });

  it("notes (not fails) when the ledger write fails", async () => {
    const { deps } = makeDeps({ recordReply: async () => { throw new Error("disk full"); } });
    const res = await sendWithReply({ session, message: "hi", inReplyTo: "msg-1", deps });
    expect(res.success).toBe(true);
    expect(res.message).toContain("LEDGER NOT UPDATED");
  });

  it("returns failure when delivery throws", async () => {
    const { deps } = makeDeps({ deliver: async () => { throw new Error("socket down"); } });
    const res = await sendWithReply({ session, message: "hi", deps });
    expect(res.success).toBe(false);
    expect(res.message).toBe("socket down");
  });

  it("interrupts a busy session before delivery", async () => {
    const calls: string[] = [];
    const { deps } = makeDeps({
      interrupt: async () => { calls.push("interrupt"); return "ok"; },
      deliver: async (_s, _b, msgId) => { calls.push("deliver"); return msgId; },
    });
    const busySession = { ...session, status: "busy" } as LiveSession;
    const res = await sendWithReply({ session: busySession, message: "hi", deps });
    expect(res.success).toBe(true);
    expect(calls).toEqual(["interrupt", "deliver"]);
  });

  it("does not interrupt an idle session", async () => {
    const interrupted: number[] = [];
    const { deps } = makeDeps({
      interrupt: async () => { interrupted.push(1); return "ok"; },
    });
    const res = await sendWithReply({ session, message: "hi", deps });
    expect(res.success).toBe(true);
    expect(interrupted).toHaveLength(0);
  });

  it("still delivers when interrupt throws", async () => {
    const delivered: number[] = [];
    const { deps } = makeDeps({
      interrupt: async () => { throw new Error("boom"); },
      deliver: async (_s, _b, msgId) => { delivered.push(1); return msgId; },
    });
    const busySession = { ...session, status: "busy" } as LiveSession;
    const res = await sendWithReply({ session: busySession, message: "hi", deps });
    expect(res.success).toBe(true);
    expect(delivered).toHaveLength(1);
  });

  it("cleans self-replies for the sender when a sender is present", async () => {
    const cleaned: string[] = [];
    const { deps } = makeDeps({
      cleanRepliesForSender: async (sid: string) => { cleaned.push(sid); return 2; },
    });
    const res = await sendWithReply({ session, message: "hi", deps });
    expect(res.success).toBe(true);
    expect(cleaned).toEqual(["sender-session"]);
  });

  it("does not clean self-replies when there is no sender", async () => {
    const cleaned: string[] = [];
    const { deps } = makeDeps({
      currentSession: async () => undefined,
      cleanRepliesForSender: async (sid: string) => { cleaned.push(sid); return 0; },
    });
    const res = await sendWithReply({ session, message: "hi", deps });
    expect(res.success).toBe(true);
    expect(cleaned).toHaveLength(0);
  });
});
