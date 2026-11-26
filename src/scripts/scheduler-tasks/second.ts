// Second-granularity task wrapper. Discovers and runs every module under
// src/scripts/scheduler-second/. Its own schedule stays at minute granularity
// (5 fields) because Bun.cron is minute-level; sub-minute cadences in the
// scanned modules use their own intervalMs / 6-field cron expressions.
//
// NOTE: Bun.cron cannot parse 6-field (seconds) cron expressions, so any
// 6-field `schedule` exported by a scanned module is parsed/collected here
// (via parseSchedule) but never handed to Bun.cron.

import { randomUUID } from "node:crypto";
import { readdirSync, openSync, closeSync, writeFileSync, mkdirSync, unlinkSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { schedulerScriptsDir } from "../../runner/scheduler";

// Hot-reload safety: a re-evaluated module must not leave the previous
// instance's timers running (module state resets, but setInterval keeps firing).
const __g = globalThis as { __secondStop?: () => void; __secondIntervals?: unknown[] };
if (typeof __g.__secondStop === "function") {
  try { __g.__secondStop(); } catch {}
}
if (Array.isArray(__g.__secondIntervals)) {
  for (const id of __g.__secondIntervals) {
    try { clearInterval(id as ReturnType<typeof setInterval>); clearTimeout(id as ReturnType<typeof setTimeout>); } catch {}
  }
}

export const schedule = "* * * * *";

export const timeZone = "UTC";

export interface ParsedSchedule {
  raw: string;
  fields: string[];
  valid: boolean;
  sixStar: boolean;
}

/** Parse a cron schedule string, accepting both 5- and 6-field expressions. */
export function parseSchedule(s: unknown): ParsedSchedule | null {
  if (typeof s !== "string") return null;
  const fields = s.trim().split(/\s+/).filter((f) => f.length > 0);
  const valid = fields.length === 5 || fields.length === 6;
  return { raw: s, fields, valid, sixStar: fields.length === 6 };
}

export interface SecondModule {
  name: string;
  schedule?: string;
  timeZone?: string;
  intervalMs?: number;
  run: () => void | Promise<void>;
}

export const modules: SecondModule[] = [];
export const schedules: string[] = [];

function secondDir(): string {
  return schedulerScriptsDir("scheduler-second");
}

function stateDir(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli");
}

function lockPath(): string {
  return join(stateDir(), "scheduler-second.lock");
}

export async function scan(dir?: string): Promise<SecondModule[]> {
  const base = dir ?? secondDir();
  let files: string[] = [];
  try {
    files = readdirSync(base)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .map((f) => join(base, f));
  } catch {
    // ignore missing dirs
  }

  const loaded: SecondModule[] = [];
  for (const file of files) {
    try {
      const mod = (await import(file)) as Record<string, unknown>;
      const run =
        typeof mod.run === "function"
          ? (mod.run as SecondModule["run"])
          : typeof mod.default === "function"
            ? (mod.default as SecondModule["run"])
            : null;
      if (!run) continue;

      const sched = typeof mod.schedule === "string" ? (mod.schedule as string) : undefined;
      const tz = typeof mod.timeZone === "string" ? (mod.timeZone as string) : undefined;
      const intervalMs = typeof mod.intervalMs === "number" ? (mod.intervalMs as number) : undefined;

      loaded.push({ name: file, schedule: sched, timeZone: tz, intervalMs, run });
    } catch (err) {
      console.error(`[second] failed to load module ${file}:`, err);
    }
  }

  return loaded;
}

let armed = false;
let leader = false;
let exitHandlersRegistered = false;
let lastRunDir: string | undefined;
const intervals: ReturnType<typeof setInterval>[] = [];
const exitHandlers: { exit?: () => void; sigterm?: () => void; sigint?: () => void } = {};
const inFlight = new Set<SecondModule>();

// Publish to globalThis so a hot-reloaded instance can stop this one.
const __g2 = globalThis as { __secondIntervals?: ReturnType<typeof setInterval>[] };
__g2.__secondIntervals = intervals;

interface LeaderLock {
  token: string;
  pid: number;
  instanceId: string;
  heartbeatAt: number;
}

// The uuid makes the token unique per module instance, so a recycled pid or
// a hot-reload survivor cannot be mistaken for the current leader.
const instanceId = randomUUID();
let ownerToken: string | null = null;

function readLeaderLock(): LeaderLock | null {
  try {
    const v = JSON.parse(readFileSync(lockPath(), "utf8"));
    if (!v || typeof v !== "object") return null;
    if (
      typeof v.token !== "string" || !Number.isInteger(v.pid) ||
      typeof v.instanceId !== "string" || typeof v.heartbeatAt !== "number"
    ) return null;
    return { token: v.token, pid: v.pid, instanceId: v.instanceId, heartbeatAt: v.heartbeatAt };
  } catch {
    return null;
  }
}

function isHolderAlive(lock: LeaderLock): boolean {
  if (lock.pid <= 0) return false;
  // Same pid + different token is a stale instance inside this process (or a
  // reused pid): still alive, so it must never be stolen.
  if (lock.pid === process.pid) return true;
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch (err) {
    // EPERM proves the process exists but signals are forbidden.
    return (err as { code?: string })?.code === "EPERM";
  }
}

function writeLeaderLock(): boolean {
  if (!ownerToken) return false;
  const lock = lockPath();
  const tmp = `${lock}.${instanceId}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({
      token: ownerToken,
      pid: process.pid,
      instanceId,
      heartbeatAt: Date.now(),
    }));
    // Publish in one rename so a concurrent reader never sees a partial record.
    renameSync(tmp, lock);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch {}
    return false;
  }
}

function ownsLock(): boolean {
  if (!leader || !ownerToken) return false;
  const current = readLeaderLock();
  return current?.token === ownerToken &&
    current.pid === process.pid &&
    current.instanceId === instanceId;
}

/** Called at the top of every module tick. Loss of ownership is fatal for
 * this instance: no further tick may run and all timers are cleared at once. */
function verifyLeadership(): boolean {
  if (!ownsLock()) {
    stopSecondScheduler();
    return false;
  }
  if (!writeLeaderLock()) {
    stopSecondScheduler();
    return false;
  }
  return true;
}

function intervalMsFor(m: SecondModule): number {
  if (typeof m.intervalMs === "number" && m.intervalMs > 0) return m.intervalMs;
  const sched = m.schedule;
  if (typeof sched === "string") {
    const fields = sched.trim().split(/\s+/);
    if (fields.length === 6) {
      const sec = fields[0] as string;
      if (!sec) return 60000;
      const mSec = sec.match(/^\*\/(\d+)$/);
      if (mSec) return Math.max(1000, parseInt(mSec[1] as string, 10) * 1000);
      if (sec === "*") return 1000;
      const n = parseInt(sec, 10);
      if (!isNaN(n)) return 60000; // fixed second → per minute
    }
  }
  return 60000;
}

export function stopSecondScheduler(): void {
  for (const id of intervals) {
    try {
      clearInterval(id);
      clearTimeout(id);
    } catch {}
  }
  intervals.length = 0;
  inFlight.clear();
  armed = false;
  // Never delete a lock another instance now owns: only an exact token match
  // proves this instance still holds it.
  if (ownsLock()) {
    try { unlinkSync(lockPath()); } catch {}
  }
  leader = false;
  ownerToken = null;
}

function unregisterExitHandlers(): void {
  if (!exitHandlersRegistered) return;
  if (exitHandlers.exit) process.off("exit", exitHandlers.exit);
  if (exitHandlers.sigterm) process.off("SIGTERM", exitHandlers.sigterm);
  if (exitHandlers.sigint) process.off("SIGINT", exitHandlers.sigint);
  delete exitHandlers.exit;
  delete exitHandlers.sigterm;
  delete exitHandlers.sigint;
  exitHandlersRegistered = false;
}

// Keep globalThis in sync for hot-reload cleanup.
(globalThis as { __secondStop?: () => void }).__secondStop = stopSecondScheduler;

/** Attempt to acquire the single-owner leader lock. Returns true if this instance is leader. */
async function tryAcquireLeader(): Promise<boolean> {
  leader = false;
  ownerToken = null;
  try {
    mkdirSync(stateDir(), { recursive: true });
  } catch {}
  const lp = lockPath();
  const token = `${process.pid}:${instanceId}`;
  // Two attempts: one atomic create, or one reclaim of a malformed/dead lock
  // followed by an atomic create. A live holder always wins and is never stolen.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(lp, "wx");
    } catch (err) {
      if ((err as { code?: string })?.code !== "EEXIST") return false;
      const existing = readLeaderLock();
      if (existing && isHolderAlive(existing)) return false;
      try { unlinkSync(lp); } catch {}
      continue;
    }
    try {
      ownerToken = token;
      if (!writeLeaderLock()) throw new Error("leader heartbeat write failed");
      leader = true;
      return true;
    } catch {
      ownerToken = null;
      try { unlinkSync(lp); } catch {}
      return false;
    } finally {
      try { closeSync(fd); } catch {}
    }
  }
  return false;
}

export async function run(dir?: string): Promise<{ armed: boolean; moduleCount: number; leader: boolean }> {
  if (armed) stopSecondScheduler(); // restartable: never accumulate timers
  if (!(await tryAcquireLeader())) {
    // No leader means no timers, even if a previous attempt left any behind.
    stopSecondScheduler();
    return { armed: false, moduleCount: 0, leader: false };
  }
  lastRunDir = dir;
  const mods = await scan(dir);
  modules.length = 0;
  modules.push(...mods);
  schedules.length = 0;
  for (const m of mods) {
    if (typeof m.schedule === "string") {
      const parsed = parseSchedule(m.schedule);
      if (parsed?.valid) schedules.push(m.schedule);
    }
  }
  armed = true;
  if (!exitHandlersRegistered) {
    exitHandlersRegistered = true;
    const cleanup = () => { try { stopSecondScheduler(); } catch {} };
    const onExit = cleanup;
    const onSigterm = () => { cleanup(); process.exit(0); };
    const onSigint = () => { cleanup(); process.exit(0); };
    process.on("exit", onExit);
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);
    exitHandlers.exit = onExit;
    exitHandlers.sigterm = onSigterm;
    exitHandlers.sigint = onSigint;
  }
  for (const m of mods) {
    const ms = intervalMsFor(m);
    const tick = async () => {
      // Heartbeat + ownership check happen before every module tick.
      if (!verifyLeadership()) return;
      if (inFlight.has(m)) return;
      inFlight.add(m);
      try { await m.run(); } catch (err) { console.error(`[second] module ${m.name} tick failed:`, err); } finally { inFlight.delete(m); }
    };
    const id = setInterval(() => { void tick(); }, ms);
    try { id?.unref?.(); } catch {}
    intervals.push(id);
    void tick();
  }
  return { armed: true, moduleCount: mods.length, leader: true };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (import.meta.hot) {
      import.meta.hot.data.armed = armed;
      import.meta.hot.data.lastDir = lastRunDir;
    }
    try { unregisterExitHandlers(); } catch {}
    try { stopSecondScheduler(); } catch {}
  });
}

if (import.meta.hot?.data?.armed) {
  const persistedDir = import.meta.hot.data.lastDir as string | undefined;
  setTimeout(() => { void run(persistedDir); }, 0);
}

export default { schedule, timeZone, parseSchedule, modules, schedules, scan, run, stopSecondScheduler };
