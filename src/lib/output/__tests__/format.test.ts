import { describe, expect, it } from "bun:test";
import { escHtml, formatTime, oneLine, plural, preHtml } from "../format";

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

describe("escHtml", () => {
  it("escapes ampersands, angle brackets", () => {
    expect(escHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("leaves plain text unchanged", () => {
    expect(escHtml("hello")).toBe("hello");
  });
});

describe("preHtml", () => {
  it("wraps text in a whitespace-pre-wrap pre block", () => {
    expect(preHtml("hello")).toBe('<pre class="whitespace-pre-wrap">hello</pre>');
  });

  it("escapes HTML special characters", () => {
    expect(preHtml("a < b & c > d")).toBe('<pre class="whitespace-pre-wrap">a &lt; b &amp; c &gt; d</pre>');
  });

  it("preserves newlines", () => {
    expect(preHtml("line1\nline2")).toBe('<pre class="whitespace-pre-wrap">line1\nline2</pre>');
  });

  it("does not interpret markdown", () => {
    const out = preHtml("line1\nline2 **bold** <tag>");
    expect(out).toContain("line1\nline2 **bold** &lt;tag&gt;");
    expect(out).not.toContain("<strong>");
    expect(out).not.toContain("<p>");
  });

  it("handles empty text", () => {
    expect(preHtml("")).toBe('<pre class="whitespace-pre-wrap"></pre>');
  });
});
