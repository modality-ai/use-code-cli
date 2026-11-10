import { describe, expect, it } from "bun:test";
import { parseOAuthExpiry, parseLoginUrl } from "../route";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("parseOAuthExpiry", () => {
  it("returns null for empty input", () => {
    expect(parseOAuthExpiry("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseOAuthExpiry("not json")).toBeNull();
  });

  it("returns null when no claudeAiOauth present", () => {
    expect(parseOAuthExpiry(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("parses numeric expiresAt into ISO string", () => {
    const ms = Date.UTC(2026, 0, 1, 0, 0, 0);
    const raw = JSON.stringify({ claudeAiOauth: { expiresAt: ms } });
    expect(parseOAuthExpiry(raw)).toBe(new Date(ms).toISOString());
  });

  it("parses string expiresAt into ISO string", () => {
    const iso = "2026-06-15T12:00:00.000Z";
    const raw = JSON.stringify({ claudeAiOauth: { expiresAt: iso } });
    expect(parseOAuthExpiry(raw)).toBe(new Date(iso).toISOString());
  });

  it("returns null for non-finite expiresAt without token fallback", () => {
    const raw = JSON.stringify({ claudeAiOauth: { expiresAt: "not-a-date" } });
    expect(parseOAuthExpiry(raw)).toBeNull();
  });

  it("falls back to JWT exp claim when expiresAt missing", () => {
    const exp = 1700000000;
    const header = b64url({ alg: "HS256", typ: "JWT" });
    const payload = b64url({ exp });
    const token = `${header}.${payload}.sig`;
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: token } });
    expect(parseOAuthExpiry(raw)).toBe(new Date(exp * 1000).toISOString());
  });

  it("returns null for malformed JWT", () => {
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: "not.a.jwt.with.extra" } });
    // 4 parts -> not 3, so skipped; no expiresAt -> null
    expect(parseOAuthExpiry(raw)).toBeNull();
  });

  it("returns null for JWT with invalid base64 payload", () => {
    const token = "aaa.!!!invalid!!!.bbb";
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: token } });
    expect(parseOAuthExpiry(raw)).toBeNull();
  });

  it("prefers expiresAt over JWT exp when both present", () => {
    const ms = Date.UTC(2026, 0, 1, 0, 0, 0);
    const exp = 1700000000;
    const header = b64url({ alg: "HS256" });
    const payload = b64url({ exp });
    const token = `${header}.${payload}.sig`;
    const raw = JSON.stringify({ claudeAiOauth: { expiresAt: ms, accessToken: token } });
    expect(parseOAuthExpiry(raw)).toBe(new Date(ms).toISOString());
  });
});

describe("parseLoginUrl", () => {
  it("returns null for empty input", () => {
    expect(parseLoginUrl("")).toBeNull();
  });

  it("extracts URL from 'If the browser didn't open, visit:' message", () => {
    const text = "If the browser didn't open, visit: https://claude.ai/oauth/authorize?foo=bar";
    expect(parseLoginUrl(text)).toBe("https://claude.ai/oauth/authorize?foo=bar");
  });

  it("strips trailing punctuation from extracted URL", () => {
    const text = "If the browser didn't open, visit: https://example.com/path).";
    expect(parseLoginUrl(text)).toBe("https://example.com/path");
  });

  it("strips ANSI escape sequences before matching", () => {
    const text = "\x1b[32mIf the browser didn't open, visit: https://example.com/login\x1b[0m";
    expect(parseLoginUrl(text)).toBe("https://example.com/login");
  });

  it("strips OSC hyperlink escapes before matching", () => {
    const text = "\x1b]8;;https://example.com/x\x07click\x1b]8;;\x07 If the browser didn't open, visit: https://example.com/login";
    expect(parseLoginUrl(text)).toBe("https://example.com/login");
  });

  it("falls back to any https URL when visit message absent", () => {
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
});
