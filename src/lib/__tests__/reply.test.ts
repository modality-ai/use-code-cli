import { describe, expect, it } from "bun:test";
import { MAX_REPLY_HOP } from "../../config/constants";
import {
  appendReplyInstruction,
  hasReplyInstruction,
  isAutoReply,
  parseReplyMeta,
  replyMarker,
  stripReplyMarkers,
} from "../reply";

describe("reply instruction", () => {
  it("appends a terminal instruction and a marker naming the sender", () => {
    expect(appendReplyInstruction("ping", "caller", { msgId: "msg-1" })).toBe(
      "ping\n\nWhen you're done, report back with `!use-code-cli talk caller \"<your answer>\" --one-way`\n<!-- use-code-cli:auto-reply hop=1 id=msg-1 -->",
    );
  });

  it("carries the answered msg_id when the message is a reply", () => {
    const out = appendReplyInstruction("on it", "caller", {
      msgId: "msg-2",
      inReplyTo: "msg-1",
    });
    expect(out).toContain("<!-- use-code-cli:auto-reply hop=1 id=msg-2 re=msg-1 -->");
  });

  it("leaves the message alone when the sender is unknown", () => {
    expect(appendReplyInstruction("ping", undefined)).toBe("ping");
  });

  it("does not duplicate an instruction the message already carries", () => {
    const message = "done. use-code-cli talk someone --one-way";
    expect(hasReplyInstruction(message)).toBe(true);
    expect(appendReplyInstruction(message, "caller")).toBe(message);
  });

  it("recognises --in-reply-to as an instruction too", () => {
    expect(
      hasReplyInstruction("done. use-code-cli talk someone --in-reply-to abc"),
    ).toBe(true);
  });

  it("ignores a bare mention, such as a quoted log", () => {
    expect(hasReplyInstruction("the log shows use-code-cli talk worker failed")).toBe(
      false,
    );
    expect(
      appendReplyInstruction("the log shows use-code-cli talk worker failed", "caller"),
    ).toContain("report back with");
  });

  it("never annotates an automatic reply — the loop stops after one hop", () => {
    const reply = "Done.\n<!-- use-code-cli:auto-reply hop=1 id=msg-1 -->";
    expect(isAutoReply(reply)).toBe(true);
    expect(appendReplyInstruction(reply, "caller")).toBe(reply);
  });

  it("replaces a hop=0 marker instead of stacking another", () => {
    const out = appendReplyInstruction(
      "please run it\n<!-- use-code-cli:auto-reply hop=0 id=old -->",
      "caller",
      { msgId: "new" },
    );
    expect(out).toBe(
      "please run it\n\nWhen you're done, report back with `!use-code-cli talk caller \"<your answer>\" --one-way`\n<!-- use-code-cli:auto-reply hop=1 id=new -->",
    );
  });
});

describe("reply marker", () => {
  it("builds every attribute it is given", () => {
    expect(replyMarker(2, { msgId: "a", inReplyTo: "b" })).toBe(
      "<!-- use-code-cli:auto-reply hop=2 id=a re=b -->",
    );
  });

  it("parses hop and ids", () => {
    expect(
      parseReplyMeta("hi\n<!-- use-code-cli:auto-reply hop=3 id=a re=b -->"),
    ).toEqual({ hop: 3, id: "a", inReplyTo: "b" });
  });

  it("ignores prose and returns undefined without a marker", () => {
    expect(parseReplyMeta("just a message")).toBeUndefined();
  });

  it("lets the newest quoted marker win", () => {
    expect(
      parseReplyMeta(
        "old\n<!-- use-code-cli:auto-reply hop=0 id=one -->\nnew\n<!-- use-code-cli:auto-reply hop=1 id=two -->",
      ),
    ).toEqual({ hop: 1, id: "two", inReplyTo: undefined });
  });

  it("treats a marker without a hop count as a reply", () => {
    expect(parseReplyMeta("<!-- use-code-cli:auto-reply -->")?.hop).toBe(
      MAX_REPLY_HOP,
    );
    expect(isAutoReply("<!-- use-code-cli:auto-reply -->")).toBe(true);
  });

  it("is not triggered by a hop=0 marker", () => {
    expect(isAutoReply("<!-- use-code-cli:auto-reply hop=0 -->")).toBe(false);
  });

  it("strips markers without touching the message", () => {
    expect(
      stripReplyMarkers(
        "please run it\n\n<!-- use-code-cli:auto-reply hop=0 -->\n",
      ),
    ).toBe("please run it");
  });
});
