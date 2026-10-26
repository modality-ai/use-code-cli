import { describe, expect, it } from "bun:test";
import { formatTime, oneLine, plural } from "../format";

describe("oneLine", () => {
  it("collapses whitespace and trims", () => {
    expect(oneLine("a\n  b\t c ", 80)).toBe("a b c");
  });

  it("clips past max with an ellipsis", () => {
    expect(oneLine("abcdef", 4)).toBe("abc…");
  });

  it("keeps text at exactly max", () => {
    expect(oneLine("abcd", 4)).toBe("abcd");
  });
});

describe("plural", () => {
  it("pluralises zero", () => {
    expect(plural(0, "session")).toBe("0 sessions");
  });

  it("keeps one singular", () => {
    expect(plural(1, "session")).toBe("1 session");
  });

  it("pluralises many", () => {
    expect(plural(2, "session")).toBe("2 sessions");
  });
});

describe("formatTime", () => {
  it("returns empty for an absent timestamp", () => {
    expect(formatTime(undefined)).toBe("");
    expect(formatTime(0)).toBe("");
  });

  it("renders sv-SE local time to the second", () => {
    expect(formatTime(1735689600000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
