import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { pruneSelfReplies, type ReplyRecord } from "../reply-ledger";

const tmpHome = mkdtempSync(join(tmpdir(), "rl-"));

beforeEach(() => {
  process.env.HOME = tmpHome;
  try { rmSync(join(tmpHome, ".use-code-cli", "talk-replies.json"), { force: true }); } catch {}
});

// dynamic imports after env is set are unnecessary now that stateDir is lazy;
// static import is fine because stateDir() reads env at call time.
import { findRepliesForTarget, removeReply, recordReply } from "../reply-ledger";

describe("pruneSelfReplies", () => {
  const mk = (target: string): ReplyRecord => ({
    inReplyTo: "msg-1",
    targetSessionId: target,
    msgId: "m",
    at: 1,
  });

  it("removes entries whose target is the sender session", () => {
    const records = [mk("sender-session"), mk("other-session")];
    const kept = pruneSelfReplies(records, "sender-session");
    expect(kept).toHaveLength(1);
    expect(kept[0]!.targetSessionId).toBe("other-session");
  });

  it("keeps all entries when none target the sender", () => {
    const records = [mk("a"), mk("b")];
    expect(pruneSelfReplies(records, "sender-session")).toHaveLength(2);
  });

  it("returns empty when all target the sender", () => {
    const records = [mk("sender-session"), mk("sender-session")];
    expect(pruneSelfReplies(records, "sender-session")).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const records = [mk("sender-session"), mk("other")];
    const copy = [...records];
    pruneSelfReplies(records, "sender-session");
    expect(records).toEqual(copy);
  });
});

describe("findRepliesForTarget", () => {
  it("returns only replies whose target matches", async () => {
    await recordReply({ inReplyTo: "m1", targetSessionId: "t1", msgId: "a", at: 1 });
    await recordReply({ inReplyTo: "m2", targetSessionId: "t2", msgId: "b", at: 2 });
    await recordReply({ inReplyTo: "m3", targetSessionId: "t1", msgId: "c", at: 3 });
    const res = await findRepliesForTarget("t1");
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.inReplyTo).sort()).toEqual(["m1", "m3"]);
  });

  it("returns empty when no replies", async () => {
    expect(await findRepliesForTarget("nope")).toEqual([]);
  });
});

describe("removeReply", () => {
  it("removes matching inReplyTo + target and returns count", async () => {
    await recordReply({ inReplyTo: "m1", targetSessionId: "t1", msgId: "a", at: 1 });
    await recordReply({ inReplyTo: "m2", targetSessionId: "t1", msgId: "b", at: 2 });
    const removed = await removeReply("m1", "t1");
    expect(removed).toBe(1);
    const remaining = await findRepliesForTarget("t1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.inReplyTo).toBe("m2");
  });

  it("returns 0 when nothing matches", async () => {
    await recordReply({ inReplyTo: "m1", targetSessionId: "t1", msgId: "a", at: 1 });
    expect(await removeReply("nope", "t1")).toBe(0);
    expect(await removeReply("m1", "other")).toBe(0);
  });
});
