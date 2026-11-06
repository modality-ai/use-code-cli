import { describe, expect, it } from "bun:test";
import { parseOAuthExpiry } from "../route";

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
