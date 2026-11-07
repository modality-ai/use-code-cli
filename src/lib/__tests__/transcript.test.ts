import { describe, expect, it } from "bun:test";
import { parseTranscript } from "../transcript";

describe("parseTranscript", () => {
  it("returns empty array for empty input", () => {
    expect(parseTranscript([])).toEqual([]);
  });

  it("skips malformed lines", () => {
    expect(parseTranscript(["not json", "{bad", ""])).toEqual([]);
  });

  it("parses a simple user text message", () => {
    const lines = [JSON.stringify({ type: "user", message: { content: "hello" } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: "user", text: "hello" });
  });

  it("parses a user message with text blocks", () => {
    const lines = [JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("hi");
  });

  it("parses an assistant text message", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "reply" }] } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: "assistant", text: "reply" });
  });

  it("attaches tool results to the originating tool_use", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: { cmd: "ls" } }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "file.txt" }] } }),
    ];
    const out = parseTranscript(lines);
    // assistant entry with tool
    const assistant = out.find((e) => e.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.tools).toBeDefined();
    expect(assistant!.tools![0]!.name).toBe("bash");
    expect(assistant!.tools![0]!.result).toBe("file.txt");
  });

  it("parses assistant string content", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: "plain string" } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("plain string");
  });

  it("strips reasoning tags from assistant text, keeping visible text", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "<think>plan" + "</think>TARGET: done | STATUS: ok" }] } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("TARGET: done | STATUS: ok");
  });

  it("drops a think-only assistant message without tools", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "<think>pure reasoning" + "</think>" }] } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(0);
  });

  it("keeps a think-only assistant message that has tools, with empty text", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "<think>reasoning only" + "</think>" }, { type: "tool_use", id: "t2", name: "bash", input: {} }] },
      }),
    ];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("");
    expect(out[0]!.tools![0]!.name).toBe("bash");
  });

  it("handles a conversation with multiple turns", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { content: "q" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "a" }] } }),
    ];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.role)).toEqual(["user", "assistant"]);
  });
});

  it("strips an unclosed reasoning tag to the end of the text", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "visible " + "<think>" + "hidden forever" }] } })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("visible");
  });

  it("parses an away_summary recap with reasoning tags", () => {
    const lines = [JSON.stringify({ type: "system", subtype: "away_summary", content: "<think>" + "drafting recap. " + "</think>" + "recap of session" })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe("system");
    expect(out[0]!.text).toBe("recap of session");
  });

  it("drops an away_summary recap that is reasoning-only with unclosed tag", () => {
    const lines = [JSON.stringify({ type: "system", subtype: "away_summary", content: "<think>" + "cut off mid-recap" })];
    const out = parseTranscript(lines);
    expect(out).toHaveLength(0);
  });

// Build the reasoning-tag literals from char codes: parsing input should
// contain them, so the same mangling that reads transcripts can't touch it.
const OPEN = String.fromCharCode(60, 116, 104, 105, 110, 107, 62); // "think"
const CLOSE = String.fromCharCode(60, 47, 116, 104, 105, 110, 107, 62); // "think"

const summary = (content: string) =>
  JSON.stringify({ type: "system", subtype: "away_summary", content });

describe("parseTranscript think-tag handling", () => {
  it("paired block is removed, surrounding text kept", () => {
    const entries = parseTranscript([
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: `before${OPEN}mid${CLOSE}after` }] },
      }),
    ]);
    expect(entries[0]!.text).toBe("beforeafter");
  });

  it("away: unclosed block, recap after blank line, junk after next blank line", () => {
    const entries = parseTranscript([summary(`${OPEN}preamble\n\nOverall goal: done\n\nLet me draft: junk`)]);
    expect(entries[0]!.text).toBe("Overall goal: done");
  });

  it("away: early closer with recap outside", () => {
    const entries = parseTranscript([summary(`${OPEN}instructions only, no blanks${CLOSE}Goal: fixed the bug`)]);
    expect(entries[0]!.text).toBe("Goal: fixed the bug");
  });

  it("away: recap inside a closed block, junk outside", () => {
    const entries = parseTranscript([summary(`${OPEN}preamble\n\nOverall goal: shipped${CLOSE}Goal… **`)]);
    expect(entries[0]!.text).toBe("Overall goal: shipped");
  });

  it("away: unclosed block with no resumption yields empty entry", () => {
    const entries = parseTranscript([summary(`${OPEN}thinking to the very end with no message`)]);
    expect(entries).toHaveLength(0);
  });

  it("assistant text renders markdown, syncs raw HTML inert", () => {
    const SCRIPT = String.fromCharCode(60, 115, 99, 114, 105, 112, 116, 62);
    const entries = parseTranscript([
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "### Heading\n\n`" + SCRIPT + "alert(1)" + String.fromCharCode(60, 47, 115, 99, 114, 105, 112, 116, 62) + "` " + SCRIPT + "alert(2)X" }],
        },
      }),
    ]);
    const html = entries[0]!.html!;
    expect(html).toContain("<h3");
    expect(html).toContain("<code");
    // code span keeps its content visible as text (single-escaped)
    expect(html).toContain("&lt;script&gt;alert(1)");
    // no double-escape and no live raw tag anywhere
    expect(html).not.toContain("&amp;lt;");
    expect(html.match(/<script/i)).toBeNull();
  });

  it("sanitizer closes unclosed formatting elements: no leak across entries", () => {
    // Bun markdown emits an unclosed <code> for this input; `code` is a
    // formatting element, so without balance the parser re-opens it inside the
    // NEXT entry's markup (wrapping the pinned row's spans).
    const entries = parseTranscript([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "broken backtick: `open" }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "next entry keeps its row clean" }] } }),
    ]);
    const html = entries[0]!.html!;
    const opens = (html.match(/<code[\s>]/g) || []).length;
    const closes = (html.match(/<\/code>/g) || []).length;
    expect(closes).toBe(opens);
    // the next entry's payload stays self-contained
    expect(entries[1]!.text).toBe("next entry keeps its row clean");
  });

  it("source-quoted chrome tags cannot reparent the fold", () => {
    const SUMMARY = String.fromCharCode(60, 115, 117, 109, 109, 97, 114, 121, 62);
    const CLOSE_DETAILS = String.fromCharCode(60, 47, 100, 101, 116, 97, 105, 108, 115, 62);
    const entries = parseTranscript([
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: `"<summary>CLICK TO SEE" + ` + SUMMARY + CLOSE_DETAILS }],
        },
      }),
    ]);
    const html = entries[0]!.html!;
    expect(html.match(/<summary/i)).toBeNull();
    expect(html.match(/<\/details/i)).toBeNull();
    expect(html).toContain("&lt;summary&gt;");
  });

  it("event handler attributes are stripped from raw HTML", () => {
    const IMG = String.fromCharCode(60) + "img src=x onerror=" + String.fromCharCode(34) + "alert(1)" + String.fromCharCode(34) + String.fromCharCode(62);
    const entries = parseTranscript([
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "pic " + IMG }] },
      }),
    ]);
    const html = entries[0]!.html!;
    expect(html).not.toContain("onerror");
    expect(html).toContain("<img src=x");
  });

  it("away: no think tags passes through", () => {
    const entries = parseTranscript([summary("plain recap text")]);
    expect(entries[0]!.text).toBe("plain recap text");
  });
});

describe("parseTranscript tool result handling", () => {
  it("truncates tool results larger than the display cap", () => {
    const big = "x".repeat(25_000);
    const entries = parseTranscript([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: big }] } }),
    ]);
    const tool = entries[0]!.tools![0]!;
    expect(tool.result!.length).toBeLessThan(big.length);
    expect(tool.result).toContain("truncated for display");
  });

  it("sets resultHtml for a non-empty tool result", () => {
    const entries = parseTranscript([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "hello **world**" }] } }),
    ]);
    const tool = entries[0]!.tools![0]!;
    expect(tool.result).toBe("hello **world**");
    expect(tool.resultHtml).toBeDefined();
    expect(tool.resultHtml).toContain("<strong>");
  });

  it("leaves resultHtml undefined for an empty tool result", () => {
    const entries = parseTranscript([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "" }] } }),
    ]);
    const tool = entries[0]!.tools![0]!;
    expect(tool.resultHtml).toBeUndefined();
  });
});

describe("parseTranscript tool id capture", () => {
  it("captures id on a tool_use block", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "abc-123", name: "bash", input: { cmd: "ls" } }] } })];
    const out = parseTranscript(lines);
    expect(out[0]!.tools![0]!.id).toBe("abc-123");
  });

  it("leaves id undefined when tool_use has no id", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "bash", input: {} }] } })];
    const out = parseTranscript(lines);
    expect(out[0]!.tools![0]!.id).toBeUndefined();
  });

  it("carries id through to the tool after result attachment", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t9", name: "bash", input: { cmd: "ls" } }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t9", content: "ok" }] } }),
    ];
    const out = parseTranscript(lines);
    const tool = out.find((e) => e.role === "assistant")!.tools![0]!;
    expect(tool.id).toBe("t9");
    expect(tool.result).toBe("ok");
  });
});
