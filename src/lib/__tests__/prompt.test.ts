import { describe, expect, it } from "bun:test";
import { cleanPrompt } from "../prompt";

describe("cleanPrompt", () => {
  it("returns empty string for empty/nullish input", () => {
    expect(cleanPrompt("")).toBe("");
    expect(cleanPrompt(null as any)).toBe("");
    expect(cleanPrompt(undefined as any)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(cleanPrompt("  hello  ")).toBe("hello");
  });

  it("strips cross-session-message tags", () => {
    expect(cleanPrompt("<cross-session-message>x</cross-session-message>hi")).toBe("hi");
    expect(cleanPrompt("a<cross-session-message foo=\"bar\"/>b")).toBe("ab");
  });

  it("strips auto-reply html comments", () => {
    expect(cleanPrompt("hi <!-- use-code-cli:auto-reply hop=1 id=x -->")).toBe("hi");
  });

  it("drops trailing cross-session boilerplate", () => {
    expect(cleanPrompt("hello\nThis came from another Claude session\nmore stuff")).toBe("hello");
  });

  it("strips leading 'Another Claude session sent a message:' prefix", () => {
    expect(cleanPrompt("Another Claude session sent a message:\nhi there")).toBe("hi there");
  });

  it("leaves normal text intact", () => {
    expect(cleanPrompt("just a normal prompt")).toBe("just a normal prompt");
  });
});