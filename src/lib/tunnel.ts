import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PersistedTunnelState {
  url: string | null;
  autoReconnect?: boolean;
  active?: boolean;
  port?: string;
  lastAliveAt?: string; // ISO timestamp of the last time the tunnel was confirmed alive
}

interface TunnelSession {
  id: string;
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  output: string[];
  done: boolean;
  exitCode: number | null;
  listeners: Set<(chunk: string) => void>;
}

// Resolve the port to tunnel from an env value (defaults to "3000").
export function tunnelPortFromEnv(value: string | undefined): string {
  const portNum = Number(value);
  return Number.isFinite(portNum) && portNum > 0 && portNum < 65536 ? String(portNum) : "3000";
}

// Extract a trycloudflare tunnel URL from a streamed chunk, if present.
export function extractTunnelUrl(chunk: string): string | null {
  const m = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}

// Exponential backoff (capped at 30s) for reconnect attempts (1-based).
export function reconnectDelay(attempt: number): number {
  return Math.min(30000, 1000 * Math.pow(2, attempt - 1));
}

const sessions = new Map<string, TunnelSession>();
let tunnelUrl: string | null = null;
let activeProc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
function tunnelStateDir(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli");
}
function tunnelStateFile(): string {
  return join(tunnelStateDir(), "tunnel.json");
}

let autoReconnectEnabled = false;
let manualStop = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export function readPersistedState(): PersistedTunnelState | null {
  try {
    const file = tunnelStateFile();
    if (!existsSync(file)) return null;
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (!v || typeof v !== "object") return null;
    return {
      url: typeof v.url === "string" ? v.url : null,
      autoReconnect: typeof v.autoReconnect === "boolean" ? v.autoReconnect : undefined,
      active: typeof v.active === "boolean" ? v.active : undefined,
      port: typeof v.port === "string" ? v.port : undefined,
      lastAliveAt: typeof v.lastAliveAt === "string" ? v.lastAliveAt : undefined,
    };
  } catch { return null; }
}

function writePersistedUrl(url: string) {
  writePersistedState({
    url,
    autoReconnect: true,
    active: true,
    port: tunnelPortFromEnv(process.env.PORT),
    lastAliveAt: new Date().toISOString(),
  });
}
export function writePersistedState(state: PersistedTunnelState) {
  try {
    mkdirSync(tunnelStateDir(), { recursive: true });
    writeFileSync(tunnelStateFile(), JSON.stringify(state), "utf8");
  } catch {}
}

function clearPersistedUrl() {
  try {
    const file = tunnelStateFile();
    if (existsSync(file)) unlinkSync(file);
  } catch {}
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

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export async function launchTunnel(): Promise<{ id: string; session: TunnelSession } | null> {
  const port = tunnelPortFromEnv(process.env.PORT);
  const projectUrl = `http://127.0.0.1:${port}`;
  const args = ["cloudflared", "tunnel", "--url", projectUrl];

  if (activeProc && activeProc.exitCode === null) {
    try { activeProc.kill(); } catch {}
    activeProc = null;
  }

  const id = randomUUID();
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    return null;
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
        const m = extractTunnelUrl(chunk);
        if (m) {
          tunnelUrl = m;
          writePersistedUrl(m);
          autoReconnectEnabled = true;
          reconnectAttempts = 0;
        }
      }
    }
  };
  (async () => {
    await Promise.all([pump(proc.stdout.getReader()), pump(proc.stderr.getReader())]);
    s.exitCode = await proc.exited;
    s.done = true;
    if (activeProc === proc) {
      activeProc = null;
      const shouldReconnect = autoReconnectEnabled && !manualStop && reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
      if (shouldReconnect) {
        tunnelUrl = null;
        reconnectAttempts += 1;
        const delay = reconnectDelay(reconnectAttempts);
        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (manualStop || !autoReconnectEnabled) return;
          void launchTunnel();
        }, delay);
      } else {
        tunnelUrl = null;
        clearPersistedUrl();
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          autoReconnectEnabled = false;
        }
      }
    }
    for (const l of s.listeners) { try { l(`\n[process exited with code ${s.exitCode}]\n`); } catch {} }
  })().catch((e) => {
    notify(s, `\nstream error: ${String(e)}\n`);
    s.exitCode = s.exitCode ?? 1;
    s.done = true;
  });

  return { id, session: s };
}

export function getSession(id: string): TunnelSession | undefined {
  return sessions.get(id);
}

// Clear a stale in-memory tunnel URL when its process is no longer alive.
// Kept separate from getTunnelStatus so it can run before persisted-URL recovery
// without the recovery being defeated by a subsequent status read.
export function clearStaleTunnelUrl() {
  if (tunnelUrl && !isTunnelAlive()) {
    tunnelUrl = null;
  }
}

export function getTunnelStatus() {
  return { tunnelUrl, autoReconnectEnabled, isTunnelAlive: isTunnelAlive() };
}

export async function recoverPersistedUrl() {
  if (!tunnelUrl) {
    const state = readPersistedState();
    const persisted = state?.url ?? null;
    if (persisted && await isUrlAlive(persisted)) {
      tunnelUrl = persisted;
      if (typeof state?.autoReconnect === "boolean") autoReconnectEnabled = state.autoReconnect;
      // Refresh lastAliveAt since we just confirmed liveness.
      writePersistedState({
        url: persisted,
        autoReconnect: autoReconnectEnabled,
        active: state?.active ?? true,
        port: state?.port,
        lastAliveAt: new Date().toISOString(),
      });
    } else if (persisted) {
      clearPersistedUrl();
    }
  }
  return tunnelUrl;
}

export async function startTunnel() {
  manualStop = false;
  autoReconnectEnabled = false;
  clearReconnectTimer();
  reconnectAttempts = 0;
  return launchTunnel();
}

export async function stopTunnel() {
  manualStop = true;
  autoReconnectEnabled = false;
  clearReconnectTimer();
  reconnectAttempts = 0;
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
  return true;
}

// Server-side bootstrap entry: ensure module loaded and recover any persisted
// tunnel URL so status is accurate without requiring a web request.
export async function initTunnel() {
  const state = readPersistedState();
  await recoverPersistedUrl();
  // On server restart/dev the cloudflared process is gone. If a tunnel was
  // previously active and its URL is no longer usable, relaunch automatically
  // instead of leaving the tunnel down until a manual click.
  if (state?.active && !tunnelUrl && !isTunnelAlive() && !manualStop) {
    await launchTunnel();
  }
}

export async function checkCloudflared(): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    const proc = Bun.spawn(["cloudflared", "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return { success: proc.exitCode === 0, version: out.trim() };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}