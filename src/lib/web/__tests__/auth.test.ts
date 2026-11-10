import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSessionCookie,
  getRpConfig,
  isLocalhost,
  issueSession,
  parseCookies,
  requireAuth,
  resetSecretCache,
  SESSION_COOKIE,
  setSessionCookie,
  verifySession,
} from "../auth";

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  process.env.HOME = home;
  resetSecretCache();
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe("parseCookies", () => {
  it("returns empty for null", () => {
    expect(parseCookies(null)).toEqual({});
  });
  it("parses simple cookies", () => {
    expect(parseCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });
  it("decodes uri components", () => {
    expect(parseCookies("x=" + encodeURIComponent("a b"))).toEqual({ x: "a b" });
  });
  it("skips parts without equals", () => {
    expect(parseCookies("garbage; a=1")).toEqual({ a: "1" });
  });
});

describe("isLocalhost", () => {
  it("true for localhost variants and null", () => {
    expect(isLocalhost("localhost")).toBe(true);
    expect(isLocalhost("localhost:3000")).toBe(true);
    expect(isLocalhost("127.0.0.1")).toBe(true);
    expect(isLocalhost("127.0.0.1:80")).toBe(true);
    expect(isLocalhost("::1")).toBe(true);
    expect(isLocalhost("[::1]")).toBe(true);
    expect(isLocalhost(null)).toBe(true);
  });
  it("false for remote hosts", () => {
    expect(isLocalhost("example.com")).toBe(false);
    expect(isLocalhost("192.168.1.1")).toBe(false);
  });
});

describe("session cookies", () => {
  it("setSessionCookie omits Secure on localhost", () => {
    const local = setSessionCookie("tok", "localhost");
    expect(local).toContain("session=tok");
    expect(local).toContain("HttpOnly");
    expect(local).not.toContain("Secure");
  });
  it("setSessionCookie includes Secure on remote host", () => {
    const remote = setSessionCookie("tok", "example.com");
    expect(remote).toContain("Secure");
  });
  it("clearSessionCookie sets Max-Age=0", () => {
    expect(clearSessionCookie("localhost")).toContain("Max-Age=0");
  });
});

describe("getRpConfig", () => {
  it("defaults to localhost when no request and no env", () => {
    delete process.env.RP_ID;
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.RP_ORIGIN;
    delete process.env.WEBAUTHN_ORIGIN;
    const c = getRpConfig();
    expect(c.rpID).toBe("localhost");
    expect(c.origin).toBe("http://localhost:3000");
  });
  it("honors env overrides", () => {
    process.env.RP_ID = "example.com";
    process.env.RP_ORIGIN = "https://example.com";
    const c = getRpConfig();
    expect(c.rpID).toBe("example.com");
    expect(c.origin).toBe("https://example.com");
    delete process.env.RP_ID;
    delete process.env.RP_ORIGIN;
  });
  it("derives from request url", () => {
    const req = new Request("https://foo.example.com/bar");
    const c = getRpConfig(req);
    expect(c.rpID).toBe("foo.example.com");
    expect(c.origin).toBe("https://foo.example.com");
  });
});

describe("issue/verify session", () => {
  it("round trips a payload", async () => {
    const token = await issueSession("owner");
    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("owner");
    expect(typeof payload!.exp).toBe("number");
  });
  it("rejects tampered token", async () => {
    const token = await issueSession("owner");
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifySession(tampered)).toBeNull();
  });
  it("rejects null/empty/malformed", async () => {
    expect(await verifySession(null)).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("a.b")).toBeNull();
  });
});

describe("requireAuth", () => {
  it("returns ok false without cookie", async () => {
    const req = new Request("http://localhost/my");
    const r = await requireAuth(req);
    expect(r.ok).toBe(false);
  });
  it("returns ok true with valid session", async () => {
    const token = await issueSession("owner");
    const req = new Request("http://localhost/my", { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    const r = await requireAuth(req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.sub).toBe("owner");
  });
});
