import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function tunnelStateDir(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli");
}
function tunnelStateFile(): string {
  return join(tunnelStateDir(), "tunnel.json");
}
/** cloudflared's stdout/stderr land here instead of pipes (see launchTunnel). */
function tunnelLogFile(): string {
  return join(tunnelStateDir(), "tunnel.log");
}
/** The detached cloudflared's pid, so a new server instance can stop an
 * adopted orphan it never spawned (see stopTunnel). */
function cloudflaredPidFile(): string {
  return join(tunnelStateDir(), "cloudflared.pid");
}

export interface PersistedTunnelState {
  url: string | null;
  autoReconnect?: boolean;
  active?: boolean;
  port?: string;
  lastAliveAt?: string; // ISO timestamp of the last time the tunnel was confirmed alive
}

interface TunnelSession {
  id: string;
  proc: Bun.Subprocess<"ignore", number, number>;
  output: string[];
  done: boolean;
  exitCode: number | null;
  listeners: Set<(chunk: string) => void>;
}

// Shared trycloudflare quick-tunnel URL pattern (unanchored, case-insensitive).
const TRYCLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// Extract a trycloudflare tunnel URL from a streamed chunk, if present.
export function extractTunnelUrl(chunk: string): string | null {
  const m = chunk.match(TRYCLOUDFLARE_URL_RE);
  return m ? m[0] : null;
}

// Exponential backoff (capped at 30s) for reconnect attempts (1-based).
export function reconnectDelay(attempt: number): number {
  return Math.min(30000, 1000 * Math.pow(2, attempt - 1));
}

const sessions = new Map<string, TunnelSession>();
let tunnelUrl: string | null = null;
let activeProc: Bun.Subprocess<"ignore", number, number> | null = null;

// The actual server this module tunnels for, registered by the runner right
// after Bun.serve (the mcp-qdrant getHonoUrl pattern: read the bind address
// from the live server instance instead of re-deriving it from env). Nothing
// is hardcoded — before registration there is no origin to tunnel to.
let localServer: { hostname?: string; port?: number } | null = null;

/** Register the live server instance so tunnels target its real bind address. */
export function registerLocalServer(server: { hostname?: string; port?: number } | null): void {
  localServer = server;
}

/** The local origin cloudflared forwards to. Throws before registration —
 * guessing an address here would tunnel to the wrong server. */
export function getLocalProjectUrl(): string {
  if (!localServer) {
    throw new Error(
      "No local server registered: the server bootstrap must call registerLocalServer before launching a tunnel.",
    );
  }
  // Bun's Server types hostname/port as optional; the runner always provides
  // both. Mirror getHonoUrl's hostname coalesce for the degenerate unset case.
  if (typeof localServer.port !== "number" || !Number.isFinite(localServer.port)) {
    throw new Error("Registered local server has no usable port.");
  }
  // Bracket IPv6 literals — `http://::1:3000` is not a parsable URL.
  const hostname = localServer.hostname ?? "localhost";
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `http://${host}:${localServer.port}`;
}

let autoReconnectEnabled = false;
let manualStop = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// When the current launch started (0 = none). A process that stays alive but
// never produces a URL is hung: the watchdog kills and relaunches it after
// this deadline instead of waiting forever.
const LAUNCH_URL_TIMEOUT_MS = 60_000;
let lastLaunchAt = 0;

// Watchdog: a periodic tick that keeps the persisted liveness marker fresh
// while the tunnel runs, and relaunches when the exit event was missed (the
// stream-error path below never runs the reconnect logic, so without this the
// marker would go stale and a dead tunnel could linger unnoticed).
const WATCHDOG_INTERVAL_MS = 30_000;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

type WatchdogAction = "touch" | "relaunch" | "wait" | "stop";

/** Pure decision for one watchdog tick (unit-tested without timers). */
export function watchdogAction(input: {
  manualStop: boolean;
  processAlive: boolean;
  hasUrl: boolean;
  launchTimedOut?: boolean;
  backoffPending: boolean;
  autoReconnect: boolean;
  attempts: number;
  maxAttempts: number;
}): WatchdogAction {
  if (input.manualStop) return "stop";
  if (input.processAlive) {
    if (input.hasUrl) return "touch";
    // A launch that never produced a URL is hung: retry until the cap.
    if (input.launchTimedOut) {
      return input.attempts < input.maxAttempts ? "relaunch" : "stop";
    }
    return "wait";
  }
  if (input.backoffPending) return "wait"; // the exit handler already scheduled a relaunch
  if (input.autoReconnect && input.attempts < input.maxAttempts) return "relaunch";
  return "stop";
}

/** The canonical persisted state for a tunnel this instance runs or adopts. */
function writeCurrentState(url: string) {
  writePersistedState({
    url,
    autoReconnect: autoReconnectEnabled,
    active: true,
    port: typeof localServer?.port === "number" ? String(localServer.port) : undefined,
    lastAliveAt: new Date().toISOString(),
  });
}

/** Refresh the persisted lastAliveAt marker, or — when the file still
 * describes an older tunnel kept through its liveness grace — replace it with
 * the tunnel actually running once the old marker times out. No-op without a
 * persisted URL. */
function touchLastAlive() {
  return withStateLock(() => {
    const state = readPersistedState();
    if (!state?.url || !tunnelUrl) return;
    if (state.url === tunnelUrl) {
      writePersistedState({ ...state, lastAliveAt: new Date().toISOString() });
      return;
    }
    // Leave the older URL alone while its marker is fresh — so it never gets
    // refreshed by a different running tunnel — and replace it once the
    // marker times out.
    if (!shouldReplacePersistedUrl(state, tunnelUrl)) return;
    writeCurrentState(tunnelUrl);
  });
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function startWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    const launchTimedOut =
      !tunnelUrl && isTunnelAlive() && lastLaunchAt > 0 &&
      Date.now() - lastLaunchAt > LAUNCH_URL_TIMEOUT_MS;
    const action = watchdogAction({
      manualStop,
      processAlive: isTunnelAlive(),
      hasUrl: !!tunnelUrl,
      launchTimedOut,
      backoffPending: reconnectTimer !== null,
      autoReconnect: autoReconnectEnabled,
      attempts: reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
    });
    if (action === "touch") touchLastAlive();
    else if (action === "relaunch") {
      if (launchTimedOut) {
        // The process is hung without a URL — kill it and relaunch directly.
        // scheduleReconnect's timer no-ops here (autoReconnect stays false
        // until a URL is ever extracted), so the watchdog's own interval is
        // the pacing, and watchdogAction stops at the attempts cap.
        if (activeProc && activeProc.exitCode === null) {
          try { activeProc.kill(); } catch {}
        }
        reconnectAttempts += 1;
        void launchTunnel().catch(() => {});
      } else {
        void (async () => {
          // An adopted orphan cloudflared can still be serving the URL after a
          // server restart — only relaunch when nothing answers for it. Validate
          // the persisted URL before probing it (same guard as reconcile).
          const url = tunnelUrl ?? readPersistedState()?.url ?? null;
          if (url && isPersistableTunnelUrl(url) && await isUrlAlive(url)) {
            touchLastAlive();
            return;
          }
          scheduleReconnect();
        })();
      }
    } else if (action === "stop") {
      // Stopping at the launch-timeout cap leaves a hung process alive with no
      // further watchdog ticks — kill it so nothing lingers untracked.
      if (launchTimedOut && activeProc && activeProc.exitCode === null) {
        try { activeProc.kill(); } catch {}
      }
      stopWatchdog();
    }
  }, WATCHDOG_INTERVAL_MS);
  // Don't keep the process alive just for the watchdog after shutdown.
  watchdogTimer.unref?.();
}

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
  // Serialize with the other persisted-state writers (touch/reconcile) so a
  // write for a newer URL can't be clobbered by an in-flight reconcile of an
  // older one.
  void withStateLock(() => {
    const existing = readPersistedState();
    // Keep a recently-alive persisted URL (e.g. an adopted orphan left behind
    // by a server restart) — only replace it once its marker times out.
    if (!shouldReplacePersistedUrl(existing, url)) return;
    writeCurrentState(url);
  });
}
export function writePersistedState(state: PersistedTunnelState) {
  try {
    mkdirSync(tunnelStateDir(), { recursive: true });
    writeFileSync(tunnelStateFile(), JSON.stringify(state), "utf8");
  } catch {}
}

function removePersistedFile() {
  try {
    const file = tunnelStateFile();
    if (existsSync(file)) unlinkSync(file);
  } catch {}
}

// Serialized persisted-state mutations: a read-modify-write (the watchdog's
// touch) must not interleave with a reconcile's write or removal, or one
// writer clobbers the other's fields.
let stateLock: Promise<unknown> = Promise.resolve();

/** Run `fn` after every previously queued state mutation completes. */
function withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = stateLock.then(fn);
  stateLock = run.catch(() => undefined);
  return run;
}

// A failed liveness probe is not proof the tunnel is gone: a transient network
// error or a slow cloudflared start can look dead. Keep the persisted state if
// it was confirmed alive within this grace window.
const ALIVE_GRACE_MS = 60_000;

/** True when `lastAliveAt` falls inside the liveness grace window. */
export function isRecentlyAlive(lastAliveAt: string | undefined, graceMs: number = ALIVE_GRACE_MS): boolean {
  if (!lastAliveAt) return false;
  const at = Date.parse(lastAliveAt);
  if (!Number.isFinite(at)) return false;
  const age = Date.now() - at;
  return age >= 0 && age <= graceMs;
}

/**
 * Decide whether a newly extracted tunnel URL may replace the persisted
 * state. A *different* URL whose liveness marker is still fresh is kept, so
 * a quick server restart does not drop the last known-good tunnel.json
 * before an adoption retry can use it; it is replaced once the marker times
 * out (or when there is no state, the URL is unchanged, or it is stale).
 */
export function shouldReplacePersistedUrl(existing: PersistedTunnelState | null, newUrl: string): boolean {
  if (!existing?.url) return true;
  if (existing.url === newUrl) return true;
  return !isRecentlyAlive(existing.lastAliveAt);
}

// Only trycloudflare quick-tunnel URLs are ever persisted; anything else in
// the state file is corrupt or tampered and must not be probed (that would
// make the server fetch an arbitrary host). Must be *exactly* a trycloudflare
// URL — no path, no extra text.
function isPersistableTunnelUrl(url: string): boolean {
  const m = url.match(TRYCLOUDFLARE_URL_RE);
  return !!m && m[0] === url;
}

// Probe a persisted tunnel URL once and reconcile the on-disk state:
//   alive          → refresh the liveness marker and keep the state
//   recently alive → keep it too (a failed probe is treated as transient)
//   otherwise      → delete the state
// Single source of truth for the adopt/keep/clear decision.
async function reconcilePersistedUrl(
  url: string,
  state: PersistedTunnelState | null,
): Promise<{ alive: boolean; removed: boolean }> {
  if (!isPersistableTunnelUrl(url)) {
    await withStateLock(() => removePersistedFile());
    return { alive: false, removed: true };
  }
  try {
    if (await isUrlAlive(url)) {
      await withStateLock(() => {
        // Re-read inside the lock so a concurrent writer's fields survive.
        const fresh = readPersistedState();
        // A concurrent writer removed the file (explicit stop) or replaced it
        // with a different, still-fresh URL — either way their write wins.
        if (!fresh) return;
        if (fresh.url && fresh.url !== url && isRecentlyAlive(fresh.lastAliveAt)) return;
        const base = fresh.url === url ? fresh : state;
        writePersistedState({
          url,
          autoReconnect: base?.autoReconnect,
          active: base?.active ?? true,
          port: base?.port,
          lastAliveAt: new Date().toISOString(),
        });
      });
      return { alive: true, removed: false };
    }
  } catch {}
  if (isRecentlyAlive(state?.lastAliveAt)) return { alive: false, removed: false };
  await withStateLock(() => removePersistedFile());
  return { alive: false, removed: true };
}

// Prune the persisted state: keep it while the tunnel URL still answers, and
// for a short grace window after the last confirmed-alive marker. Only delete
// once the URL is unresponsive and that marker has gone stale.
export async function prunePersistedUrl(): Promise<boolean> {
  const state = readPersistedState();
  const url = state?.url ?? null;
  if (!url) {
    await withStateLock(() => removePersistedFile());
    return true;
  }
  return (await reconcilePersistedUrl(url, state)).removed;
}
// A tunnel URL is alive when its cloudflared endpoint answers at all: a 5xx
// from the origin behind a live tunnel (502 Bad Gateway while the local
// server is still binding its port after a restart) still proves the tunnel
// serves — it heals once the origin is up. Only a dead tunnel counts as
// gone: connection failure, or Cloudflare edge's 530 (tunnel unreachable).
async function isUrlAlive(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return r.status !== 530;
  } catch { return false; }
}

function isTunnelAlive(): boolean {
  return !!activeProc && activeProc.exitCode === null;
}

// The orphan-kill signature: our spawned cloudflared always targets the local
// origin, but the hostname may drift across restarts (options.host), so any
// loopback target matches. A decoy pointing at a remote URL does not.
const LOCAL_TARGET_RE = /tunnel --url http:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]):/;

// Bound the per-session replay history: a late stream connection gets the
// recent tail only, but memory no longer grows with a long-running tunnel's
// log.
const MAX_SESSION_OUTPUT_CHUNKS = 500;

function notify(s: TunnelSession, chunk: string) {
  s.output.push(chunk);
  if (s.output.length > MAX_SESSION_OUTPUT_CHUNKS) {
    s.output.splice(0, s.output.length - MAX_SESSION_OUTPUT_CHUNKS);
  }
  for (const l of s.listeners) {
    try { l(chunk); } catch {}
  }
}

// Finished sessions stay in the map so a late stream connection can still
// replay their log — but only the most recent ones, or repeated relaunches
// would grow the map without bound. Evicted ids answer "session not found".
const MAX_DONE_SESSIONS = 20;

function pruneSessions() {
  const done = [...sessions.entries()].filter(([, s]) => s.done && s.listeners.size === 0);
  const excess = done.length - MAX_DONE_SESSIONS;
  if (excess > 0) {
    for (const [id] of done.slice(0, excess)) sessions.delete(id);
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Shared by the exit handler and the watchdog so both reconnect paths follow
// the same backoff schedule with the same guards.
function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = reconnectDelay(reconnectAttempts);
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (manualStop || !autoReconnectEnabled) return;
    void launchTunnel();
  }, delay);
}

export async function launchTunnel(): Promise<{ id: string; session: TunnelSession } | null> {
  // An explicit stop can race the watchdog's hung-launch relaunch: spawning
  // after the stop would leave an unadopted orphan cloudflared nobody stops.
  if (manualStop) return null;
  const projectUrl = getLocalProjectUrl();
  // CLOUDFLARED_BIN overrides the binary (tests point it at a fake — Bun.which
  // and Bun.spawn do not see a runtime-modified PATH).
  const cloudflaredBin = process.env.CLOUDFLARED_BIN || "cloudflared";
  const args = [cloudflaredBin, "tunnel", "--url", projectUrl];

  if (activeProc && activeProc.exitCode === null) {
    try { activeProc.kill(); } catch {}
    activeProc = null;
  }

  // Bun.spawn fails asynchronously (the 'error' event), so probe the binary
  // up front to keep the synchronous "failed to spawn" contract.
  if (!cloudflaredBin.includes("/") && !Bun.which(cloudflaredBin)) return null;

  const id = randomUUID();
  let logFd: number;
  try {
    mkdirSync(tunnelStateDir(), { recursive: true });
    // Fresh log per launch: the tail reader always starts from offset 0.
    logFd = openSync(tunnelLogFile(), "w");
  } catch {
    return null;
  }
  let proc: Bun.Subprocess<"ignore", number, number>;
  try {
    // Detached: cloudflared gets its own process group (setsid), so a dev
    // restart that signals the server's group leaves the tunnel running and
    // the next boot adopts it via the persisted URL.
    proc = Bun.spawn(args, { stdin: "ignore", stdout: logFd, stderr: logFd, detached: true });
    proc.unref();
  } catch {
    closeSync(logFd);
    return null;
  }
  closeSync(logFd);
  activeProc = proc;
  lastLaunchAt = Date.now();
  try { writeFileSync(cloudflaredPidFile(), String(proc.pid)); } catch {}
  startWatchdog();
  const s: TunnelSession = { id, proc, output: [], done: false, exitCode: null, listeners: new Set() };
  pruneSessions();
  sessions.set(id, s);

  // The detached process writes to the log file the server tails. Pipes would
  // fill and block the orphan once the server that reads them dies.
  const LOG_TAIL_INTERVAL_MS = 250;
  let tailPos = 0;
  // A URL can straddle two tail reads (split log writes); a rolling window of
  // the recent tail keeps the extraction contiguous even when a startup burst
  // trails the URL line with more log output. Fresh per launch.
  let extractWindow = "";
  const EXTRACT_WINDOW_BYTES = 1024;
  let tailChain: Promise<void> = Promise.resolve();
  const readTail = () => {
    tailChain = tailChain
      .catch(() => {})
      .then(async () => {
        const size = (await stat(tunnelLogFile())).size;
        if (size === tailPos) return;
        const start = size < tailPos ? 0 : tailPos; // truncated → re-read from the top
        tailPos = size;
        const fh = await open(tunnelLogFile(), "r");
        try {
          const buf = Buffer.alloc(size - start);
          await fh.read(buf, 0, buf.length, start);
          const chunk = buf.toString("utf8");
          notify(s, chunk);
          extractWindow = (extractWindow + chunk).slice(-EXTRACT_WINDOW_BYTES);
          // Prefer this chunk itself: a burst longer than the window could
          // otherwise carry the URL out of its reach. The window still catches
          // a URL split across two reads.
          const m = extractTunnelUrl(chunk) ?? extractTunnelUrl(extractWindow);
          // manualStop: between stopTunnel's state removal and the exit
          // event. procExited: the exit path already pruned or re-scheduled
          // the state. A late tail read of a dead/dying session (its timer
          // outlives the kill) must not resurrect tunnel.json.
          if (m && !manualStop && !procExited) {
            tunnelUrl = m;
            autoReconnectEnabled = true;
            reconnectAttempts = 0;
            writePersistedUrl(m);
          }
        } finally {
          await fh.close();
        }
      });
    return tailChain;
  };
  const tailTimer = setInterval(() => {
    void readTail().catch(() => {});
  }, LOG_TAIL_INTERVAL_MS);
  // Don't keep the process alive just for the tail after shutdown.
  tailTimer.unref?.();

  // Once the exit event lands, tail reads must not persist a URL: the exit
  // path has just pruned or re-scheduled the state, and the extract window
  // still holds the dead tunnel's URL.
  let procExited = false;
  (async () => {
    s.exitCode = await proc.exited;
    procExited = true;
    if (activeProc === proc) {
      activeProc = null;
      const shouldReconnect = autoReconnectEnabled && !manualStop && reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
      if (shouldReconnect) {
        tunnelUrl = null;
        scheduleReconnect();
      } else {
        tunnelUrl = null;
        await prunePersistedUrl();
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          autoReconnectEnabled = false;
        }
      }
    }
    // One final tail read after one tick so the last log lines reach the
    // stream before the session is marked done.
    await new Promise((r) => setTimeout(r, LOG_TAIL_INTERVAL_MS));
    await readTail();
    clearInterval(tailTimer);
    s.done = true;
    for (const l of s.listeners) { try { l(`\n[process exited with code ${s.exitCode}]\n`); } catch {} }
  })().catch((e) => {
    clearInterval(tailTimer);
    notify(s, `\nstream error: ${String(e)}\n`);
    s.exitCode = s.exitCode ?? 1;
    s.done = true;
    // The tail died without a clean exit event, so release the process —
    // otherwise isTunnelAlive() stays true forever and the watchdog keeps
    // refreshing the marker for a dead tunnel instead of relaunching.
    if (activeProc === proc) activeProc = null;
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

/**
 * Reconcile the persisted tunnel with the live process: adopt a URL that still
 * answers, keep one that only recently went quiet, clear one that is gone.
 * Returns the persisted state that drove the decision.
 */
async function restoreTunnel(): Promise<PersistedTunnelState | null> {
  const state = readPersistedState();
  if (tunnelUrl) return state;
  const persisted = state?.url ?? null;
  if (!persisted) return state;
  const { alive } = await reconcilePersistedUrl(persisted, state);
  if (alive) {
    tunnelUrl = persisted;
    if (typeof state?.autoReconnect === "boolean") autoReconnectEnabled = state.autoReconnect;
  }
  return state;
}

export async function recoverPersistedUrl() {
  await restoreTunnel();
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
  stopWatchdog();
  reconnectAttempts = 0;
  if (activeProc) {
    try { activeProc.kill(); } catch {}
    activeProc = null;
  }
  for (const s of sessions.values()) {
    try { s.proc.kill(); } catch {}
  }
  // The pid file names a cloudflared this instance may not have spawned (an
  // adopted orphan from a previous server). Verify its command line carries
  // our spawn signature before signalling — the pid may have been recycled by
  // an unrelated process (e.g. a grep mentioning "cloudflared"). The spawned
  // args always target a loopback origin (see LOCAL_TARGET_RE): a decoy
  // merely carrying the words "cloudflared tunnel --url" with a remote URL
  // does not match, and the hostname may drift across restarts.
  try {
    const orphanPid = Number.parseInt(readFileSync(cloudflaredPidFile(), "utf8").trim(), 10);
    if (Number.isInteger(orphanPid) && orphanPid > 1) {
      const cmd = execFileSync("ps", ["-o", "command=", "-p", String(orphanPid)], { encoding: "utf8" });
      if (cmd.includes("cloudflared") && LOCAL_TARGET_RE.test(cmd)) {
        try { process.kill(orphanPid, "SIGTERM"); } catch {}
      }
    }
  } catch {}
  try { unlinkSync(cloudflaredPidFile()); } catch {}
  sessions.clear();
  tunnelUrl = null;
  // Wait for any queued locked writes (touch/reconcile) to land first, then
  // remove the file — otherwise a pending write could resurrect tunnel.json
  // after an explicit stop.
  await withStateLock(() => removePersistedFile());
  return true;
}

// Server-side bootstrap entry: ensure module loaded and recover any persisted
// tunnel URL so status is accurate without requiring a web request.
export async function initTunnel() {
  const state = await restoreTunnel();
  // The detached cloudflared often outlives the server — restoreTunnel adopts
  // it when its URL still answers. Only when no URL survived (nothing to
  // adopt) relaunch automatically instead of leaving the tunnel down until a
  // manual click.
  if (state?.active && !tunnelUrl && !isTunnelAlive() && !manualStop) {
    await launchTunnel();
  }
}

export async function checkCloudflared(): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    const bin = process.env.CLOUDFLARED_BIN || "cloudflared";
    const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return { success: proc.exitCode === 0, version: out.trim() };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
