// Second-granularity task wrapper. Discovers and runs every module under
// src/scripts/scheduler-second/. Its own schedule stays at minute granularity
// (5 fields) because Bun.cron is minute-level; sub-minute cadences in the
// scanned modules use their own intervalMs / 6-field cron expressions.
//
// NOTE: Bun.cron cannot parse 6-field (seconds) cron expressions, so any
// 6-field `schedule` exported by a scanned module is parsed/collected here
// (via parseSchedule) but never handed to Bun.cron.

import { readdirSync, openSync, closeSync, statSync, writeFileSync, mkdirSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
  return join(import.meta.dir, "..", "scheduler-second");
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
const intervals: ReturnType<typeof setInterval>[] = [];
const inFlight = new Set<SecondModule>();

// Publish to globalThis so a hot-reloaded instance can stop this one.
const __g2 = globalThis as { __secondIntervals?: ReturnType<typeof setInterval>[] };
__g2.__secondIntervals = intervals;

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
  // Release the leader lock we own so a subsequent run() can re-acquire it.
  if (leader) {
    try { unlinkSync(lockPath()); } catch {}
  }
  leader = false;
}

// Keep globalThis in sync for hot-reload cleanup.
(globalThis as { __secondStop?: () => void }).__secondStop = stopSecondScheduler;

/** Attempt to acquire the single-owner leader lock. Returns true if this process is leader. */
async function tryAcquireLeader(): Promise<boolean> {
  leader = false;
  try {
    mkdirSync(stateDir(), { recursive: true });
  } catch {}
  const lp = lockPath();
  let acquired = false;
  try {
    const fd = openSync(lp, "wx");
    try {
      writeFileSync(lp, String(process.pid));
      acquired = true;
    } finally {
      closeSync(fd);
    }
  } catch {
    try {
      const st = statSync(lp);
      const age = Date.now() - st.mtimeMs;
      let holderAlive = false;
      try {
        const holderPid = parseInt(readFileSync(lp, "utf8").trim(), 10);
        if (!isNaN(holderPid) && holderPid > 0 && holderPid !== process.pid) {
          try {
            process.kill(holderPid, 0);
            holderAlive = true;
          } catch (err) {
            // EPERM means the process exists but we lack permission to signal it —
            // treat as alive so we never steal a live holder's lock. ESRCH (no
            // such process) means it's dead.
            const code = (err as { code?: string })?.code;
            holderAlive = code === "EPERM";
          }
        }
      } catch {}
      const fresh = age >= 0 && age < 120_000;
      if (fresh && holderAlive) {
        return false;
      }
      try { writeFileSync(lp, String(process.pid)); } catch {}
      acquired = true;
    } catch {
      acquired = false;
    }
  }
  if (!acquired) return false;
  leader = true;
  return true;
}

export async function run(dir?: string): Promise<{ armed: boolean; moduleCount: number; leader: boolean }> {
  if (armed) stopSecondScheduler(); // restartable: never accumulate timers
  if (!(await tryAcquireLeader())) {
    return { armed: false, moduleCount: 0, leader: false };
  }

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
    process.on("exit", cleanup);
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
  }
  for (const m of mods) {
    const ms = intervalMsFor(m);
    const tick = async () => {
      // Leader heartbeat: refresh lock mtime so stale detection works.
      if (leader) {
        try { writeFileSync(lockPath(), String(process.pid)); } catch {}
      }
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

export default { schedule, timeZone, parseSchedule, modules, schedules, scan, run, stopSecondScheduler };
