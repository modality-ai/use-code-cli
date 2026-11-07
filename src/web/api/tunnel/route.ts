import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface TunnelSession {
  id: string;
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  output: string[];
  done: boolean;
  exitCode: number | null;
  listeners: Set<(chunk: string) => void>;
}

const sessions = new Map<string, TunnelSession>();
let tunnelUrl: string | null = null;
let activeProc: Bun.Subprocess<"ignore","pipe","pipe"> | null = null;
const TUNNEL_STATE_FILE = join(homedir(), ".use-code-cli-tunnel.json");

function readPersistedUrl(): string | null {
  try {
    if (!existsSync(TUNNEL_STATE_FILE)) return null;
    const v = JSON.parse(readFileSync(TUNNEL_STATE_FILE, "utf8"));
    return typeof v?.url === "string" ? v.url : null;
  } catch { return null; }
}
function writePersistedUrl(url: string) {
  try { writeFileSync(TUNNEL_STATE_FILE, JSON.stringify({ url }), "utf8"); } catch {}
}
function clearPersistedUrl() {
  try { if (existsSync(TUNNEL_STATE_FILE)) unlinkSync(TUNNEL_STATE_FILE); } catch {}
}
async function isUrlAlive(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return r.ok || r.status < 500;
  } catch { return false; }
}

function isTunnelAlive(): boolean {
  return !!activeProc && activeProc.exitCode === null;
}

function notify(s: TunnelSession, chunk: string) {
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
            s.listeners.delete(listener);
            // Final exit line is already delivered by the pump completion handler.
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

  // status: check cloudflared availability
  // Clear stale URL if the tunnel process is no longer alive
  if (tunnelUrl && !isTunnelAlive()) {
    tunnelUrl = null;
  }
  // Recover a still-valid tunnel URL (e.g. after server restart) from persisted state
  if (!tunnelUrl) {
    const persisted = readPersistedUrl();
    if (persisted && await isUrlAlive(persisted)) {
      tunnelUrl = persisted;
    } else if (persisted) {
      clearPersistedUrl();
    }
  }
  try {
    const proc = Bun.spawn(["cloudflared", "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return Response.json({ success: proc.exitCode === 0, version: out.trim(), url: tunnelUrl });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const portNum = Number(process.env.PORT);
  const port = Number.isFinite(portNum) && portNum > 0 && portNum < 65536 ? String(portNum) : "3000";
  const projectUrl = `http://127.0.0.1:${port}`;
  const args = ["cloudflared", "tunnel", "--url", projectUrl];

  // Avoid orphaning a previously running tunnel
  if (activeProc && activeProc.exitCode === null) {
    try { activeProc.kill(); } catch {}
    activeProc = null;
    tunnelUrl = null;
  }

  const id = randomUUID();
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
  activeProc = proc;
  const s: TunnelSession = { id, proc, output: [], done: false, exitCode: null, listeners: new Set() };
  sessions.set(id, s);

  const pump = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = new TextDecoder().decode(value, { stream: true });
        notify(s, chunk);
        const m = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m) { tunnelUrl = m[0]; writePersistedUrl(m[0]); }
      }
    }
  };
  (async () => {
    await Promise.all([pump(proc.stdout.getReader()), pump(proc.stderr.getReader())]);
    s.exitCode = await proc.exited;
    s.done = true;
    if (activeProc === proc) { activeProc = null; tunnelUrl = null; clearPersistedUrl(); }
    for (const l of s.listeners) { try { l(`\n[process exited with code ${s.exitCode}]\n`); } catch {} }
  })().catch((e) => {
    notify(s, `\nstream error: ${String(e)}\n`);
    s.exitCode = s.exitCode ?? 1;
    s.done = true;
  });

  return Response.json({ success: true, sessionId: id, projectUrl, url: tunnelUrl });
}


export async function DELETE(request: Request): Promise<Response> {
  try {
    if (activeProc) {
      try { activeProc.kill(); } catch {}
      activeProc = null;
    }
    for (const s of sessions.values()) {
      try { s.proc.kill(); } catch {}
    }
    sessions.clear();
    tunnelUrl = null;
    clearPersistedUrl();
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}
