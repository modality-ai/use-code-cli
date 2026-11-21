import { describe, expect, it } from "bun:test";
import { pruneSelfReplies, type ReplyRecord } from "../reply-ledger";

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