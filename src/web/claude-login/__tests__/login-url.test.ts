import { describe, expect, it } from "bun:test";
import { parseLoginUrl } from "../login-url";
import { stripAnsi } from "modality-cli-kit/strip-ansi";

describe("stripAnsi", () => {
  it("returns input unchanged when no escapes", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips CSI color escapes", () => {
    expect(stripAnsi("\x1b[32mhello\x1b[0m")).toBe("hello");
  });

  it("strips OSC hyperlink escapes", () => {
    expect(stripAnsi("\x1b]8;;https://example.com/x\x07click\x1b]8;;\x07")).toBe("click");
  });

  it("returns empty string unchanged", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips multiple consecutive escapes", () => {
    expect(stripAnsi("\x1b[32m\x1b[1mhello\x1b[0m")).toBe("hello");
  });

  it("strips escapes with multiple parameters", () => {
    expect(stripAnsi("\x1b[1;31;40mhello\x1b[0m")).toBe("hello");
  });

  it("strips escapes embedded in text", () => {
    expect(stripAnsi("a\x1b[32mb\x1b[0mc")).toBe("abc");
  });

  it("preserves text with no escape sequences", () => {
    expect(stripAnsi("plain text 123")).toBe("plain text 123");
  });
});

describe("parseLoginUrl", () => {
  it("returns null for empty input", () => {
    expect(parseLoginUrl("")).toBeNull();
  });

  it("extracts URL from visit message", () => {
    const text = "If the browser didn't open, visit: https://claude.ai/oauth/authorize?foo=bar";
    expect(parseLoginUrl(text)).toBe("https://claude.ai/oauth/authorize?foo=bar");
  });

  it("strips ANSI before matching", () => {
    const text = "\x1b[32mIf the browser didn't open, visit: https://example.com/login\x1b[0m";
    expect(parseLoginUrl(text)).toBe("https://example.com/login");
  });

  it("strips trailing punctuation", () => {
    const text = "If the browser didn't open, visit: https://example.com/path).";
    expect(parseLoginUrl(text)).toBe("https://example.com/path");
  });

  it("falls back to any https URL", () => {
    const text = "Please open https://auth.example.com/start now";
    expect(parseLoginUrl(text)).toBe("https://auth.example.com/start");
  });

  it("returns null when no URL present", () => {
    expect(parseLoginUrl("no url here")).toBeNull();
  });

  it("handles http URLs", () => {
    const text = "visit http://localhost:8080/callback";
    expect(parseLoginUrl(text)).toBe("http://localhost:8080/callback");
  });

  it("strips OSC hyperlink escapes before matching", () => {
    const text = "\x1b]8;;https://example.com/x\x07click\x1b]8;;\x07 If the browser didn't open, visit: https://example.com/login";
    expect(parseLoginUrl(text)).toBe("https://example.com/login");
  });

  it("is case-insensitive for the visit message", () => {
    const text = "IF THE BROWSER DIDN'T OPEN, VISIT: https://example.com/login";
    expect(parseLoginUrl(text)).toBe("https://example.com/login");
  });

  it("strips various trailing punctuation", () => {
    expect(parseLoginUrl("If the browser didn't open, visit: https://example.com/path]")).toBe("https://example.com/path");
    expect(parseLoginUrl("If the browser didn't open, visit: https://example.com/path,")).toBe("https://example.com/path");
    expect(parseLoginUrl("If the browser didn't open, visit: https://example.com/path;")).toBe("https://example.com/path");
  });

  it("preserves query parameters and fragments", () => {
    const text = "If the browser didn't open, visit: https://example.com/cb?code=abc&state=xyz#frag";
    expect(parseLoginUrl(text)).toBe("https://example.com/cb?code=abc&state=xyz#frag");
  });

  it("returns first URL when multiple present in fallback", () => {
    const text = "open https://first.example.com/a then https://second.example.com/b";
    expect(parseLoginUrl(text)).toBe("https://first.example.com/a");
  });

  it("handles URL at end of string without trailing space", () => {
    const text = "visit https://example.com/end";
    expect(parseLoginUrl(text)).toBe("https://example.com/end");
  });

  it("does not return URL embedded only in a stripped OSC escape", () => {
    const text = "\x1b]8;;https://hidden.example.com/x\x07click\x1b]8;;\x07 no url here";
    expect(parseLoginUrl(text)).toBeNull();
  });
});