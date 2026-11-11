import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function secretPath() {
  // Lazily resolved so tests can override HOME.
  const home = process.env.HOME || "";
  return `${home}/.use-code-cli/webauthn-secret`;
}

async function loadOrCreateSecret(): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  const path = secretPath();
  try {
    const raw = await fs.readFile(path, "utf8");
    const buf = Buffer.from(raw.trim(), "base64");
    if (buf.length >= 32) return buf;
  } catch {}
  const buf = randomBytes(32);
  await fs.mkdir(`${process.env.HOME}/.use-code-cli`, { recursive: true }).catch(() => {});
  await fs.writeFile(path, buf.toString("base64"), { mode: 0o600 }).catch(() => {});
  return buf;
}

let cachedSecret: Buffer | null = null;
export async function getSecret(): Promise<Buffer> {
  if (cachedSecret) return cachedSecret;
  cachedSecret = await loadOrCreateSecret();
  return cachedSecret;
}

export function resetSecretCache() {
  cachedSecret = null;
}

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export async function issueSession(sub = "owner"): Promise<string> {
  const secret = await getSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { sub, iat: now, exp: now + SESSION_TTL_SECONDS };
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export async function verifySession(token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const secret = await getSecret();
    const data = `${parts[0]}.${parts[1]}`;
    const sig = fromB64url(parts[2]!);
    const expected = createHmac("sha256", secret).update(data).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    const payload = JSON.parse(Buffer.from(fromB64url(parts[1]!)).toString("utf8")) as SessionPayload;
    if (!payload || typeof payload.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function isLocalhost(host: string | null): boolean {
  if (!host) return true;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end !== -1) h = h.slice(1, end);
  } else if ((h.match(/:/g) || []).length === 1) {
    h = h.split(":")[0]!;
  }
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

// CSRF check for state-changing requests: browsers attach an Origin header to
// the POST/fetch requests they initiate (a few legacy flows omit it — the
// SameSite=Lax session cookie covers those), and a cross-site attacker cannot
// forge it. Same-origin (or tunneled) requests have Origin host == request
// host. A missing Origin means a non-browser client (curl, tests) — allowed.
export function isCsrfSafe(origin: string | null | undefined, requestUrl: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

export async function requireAuth(request: Request): Promise<{ ok: true; payload: SessionPayload } | { ok: false; response: Response }> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const payload = await verifySession(cookies[SESSION_COOKIE]);
  if (!payload) {
    return { ok: false, response: new Response(JSON.stringify({ success: false, error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }) };
  }
  return { ok: true, payload };
}

export function setSessionCookie(token: string, host: string | null): string {
  const secure = !isLocalhost(host);
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_SECONDS}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(host: string | null): string {
  const secure = !isLocalhost(host);
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function getRpConfig(request?: Request) {
  const requestHost = request ? new URL(request.url).hostname : "";
  const rpID = (process.env.RP_ID || process.env.WEBAUTHN_RP_ID || requestHost || "localhost") as string;
  const proto = request?.headers?.get("x-forwarded-proto") ?? undefined;
  const isHttps = proto
    ? (proto.split(",")[0] ?? "").trim() === "https"
    : (request?.url?.startsWith("https") ?? false);
  const origin = process.env.RP_ORIGIN || process.env.WEBAUTHN_ORIGIN || (request ? `${isHttps ? "https" : "http"}://${new URL(request.url).host}` : "http://localhost:3000");
  return { rpID, origin };
}