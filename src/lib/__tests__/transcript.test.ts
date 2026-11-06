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