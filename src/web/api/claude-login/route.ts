import { randomUUID } from "node:crypto";

interface LoginSession {
  id: string;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  output: string[];
  done: boolean;
  exitCode: number | null;
  listeners: Set<(chunk: string) => void>;
}

interface LoginRequestBody {
  action?: string;
  mode?: string;
  sessionId?: string;
  value?: string;
}

const sessions = new Map<string, LoginSession>();

let lastSuccessfulLogin: { at: string; mode: string } | null = null;

export function parseOAuthExpiry(raw: string): string | null {
  if (!raw) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const oauth = (parsed as { claudeAiOauth?: { expiresAt?: unknown; accessToken?: string } } | null)?.claudeAiOauth;
  if (oauth?.expiresAt) {
    const ms = typeof oauth.expiresAt === "number" ? oauth.expiresAt : Date.parse(oauth.expiresAt as string);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  // Fallback: decode JWT access token exp claim
  const token = oauth?.accessToken;
  if (typeof token === "string" && token.split(".").length === 3) {
    try {
      const part = token.split(".")[1] || "";
      const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
      if (payload?.exp) return new Date(payload.exp * 1000).toISOString();
    } catch {}
  }
  return null;
}

async function readOAuthExpiry(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const proc = Bun.spawn(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], { stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    if (!out) return null;
    return parseOAuthExpiry(out);
  } catch {
    return null;
  }
}

function notify(s: LoginSession, chunk: string) {
  s.output.push(chunk);
  for (const l of s.listeners) {
    try { l(chunk); } catch {}
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const streamId = url.searchParams.get("stream");
  if (streamId) {
    const s = sessions.get(streamId);
    if (!s) return new Response("session not found", { status: 404 });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const c of s.output) controller.enqueue(enc.encode(c));
        if (s.done) {
          controller.enqueue(enc.encode(`\n[process exited with code ${s.exitCode}]\n`));
          controller.close();
          return;
        }
        const listener = (chunk: string) => {
          try { controller.enqueue(enc.encode(chunk)); } catch {}
        };
        s.listeners.add(listener);
        const interval = setInterval(() => {
          if (s.done) {
            clearInterval(interval);
            try { controller.enqueue(enc.encode(`\n[process exited with code ${s.exitCode}]\n`)); } catch {}
            try { controller.close(); } catch {}
          }
        }, 200);
        request.signal.addEventListener("abort", () => {
          clearInterval(interval);
          s.listeners.delete(listener);
          try { controller.close(); } catch {}
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    const proc = Bun.spawn(["claude", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    let data: unknown = null;
    try { data = JSON.parse(out.trim()); } catch { data = { raw: out.trim() }; }
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      d.lastLoginAt = lastSuccessfulLogin?.at ?? null;
      d.lastLoginMode = lastSuccessfulLogin?.mode ?? null;
      d.tokenExpiresAt = await readOAuthExpiry();
    }
    return Response.json({ success: true, data });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: LoginRequestBody = {};
  try { body = await request.json(); } catch {}
  const action = body?.action || "start";

  if (action === "input") {
    const s = sessions.get(body.sessionId!);
    if (!s) return Response.json({ success: false, error: "session not found" }, { status: 404 });
    try {
      const data = (body.value || "") + "\n";
      s.proc.stdin.write(data);
    } catch (e) {
      return Response.json({ success: false, error: String(e) }, { status: 500 });
    }
    return Response.json({ success: true });
  }

  const mode = body?.mode === "console" ? "console" : "claudeai";
  const args = ["claude", "auth", "login"];
  if (mode === "console") args.push("--console");

  const id = randomUUID();
  const proc = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const s: LoginSession = { id, proc, output: [], done: false, exitCode: null, listeners: new Set() };
  sessions.set(id, s);

  const pump = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) notify(s, new TextDecoder().decode(value));
    }
  };
  (async () => {
    await Promise.all([pump(proc.stdout.getReader()), pump(proc.stderr.getReader())]);
    s.exitCode = await proc.exited;
    s.done = true;
    if (s.exitCode === 0) {
      lastSuccessfulLogin = { at: new Date().toISOString(), mode };
    }
    for (const l of s.listeners) { try { l(`\n[process exited with code ${s.exitCode}]\n`); } catch {} }
    // Kill hung processes and clean up session after max lifetime
    setTimeout(() => {
      if (!s.done) { try { s.proc.kill(); } catch {} }
      sessions.delete(id);
    }, 5 * 60 * 1000);
  })().catch((e) => {
    notify(s, `\nstream error: ${String(e)}\n`);
    s.done = true;
  });

  return Response.json({ success: true, sessionId: id });
}
