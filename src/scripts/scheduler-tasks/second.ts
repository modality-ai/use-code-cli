// Second-granularity task wrapper. Discovers and runs every module under
// src/scripts/scheduler-second/. Its own schedule stays at minute granularity
// (5 fields) because Bun.cron is minute-level; sub-minute cadences in the
// scanned modules use their own intervalMs / 6-field cron expressions.
//
// NOTE: Bun.cron cannot parse 6-field (seconds) cron expressions, so any
// 6-field `schedule` exported by a scanned module is parsed/collected here
// (via parseSchedule) but never handed to Bun.cron.

import { readdirSync } from "node:fs";
import { join } from "node:path";

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

export async function scan(dir?: string): Promise<SecondModule[]> {
  modules.length = 0;
  schedules.length = 0;

  const base = dir ?? secondDir();
  const dirs = [base];
  let files: string[] = [];
  for (const d of dirs) {
    try {
      files = files.concat(
        readdirSync(d)
          .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
          .map((f) => join(d, f)),
      );
    } catch {
      // ignore missing dirs
    }
  }

  const loaded: SecondModule[] = [];
  for (const file of files) {
    try {
      const mod: any = await import(file);
      const run =
        typeof mod?.run === "function"
          ? mod.run
          : typeof mod?.default === "function"
            ? mod.default
            : null;
      if (!run) continue;

      const sched = typeof mod?.schedule === "string" ? mod.schedule : undefined;
      const tz = typeof mod?.timeZone === "string" ? mod.timeZone : undefined;
      const intervalMs = typeof mod?.intervalMs === "number" ? mod.intervalMs : undefined;

      if (sched) {
        const parsed = parseSchedule(sched);
        if (parsed?.valid) schedules.push(sched);
      }

      loaded.push({ name: file, schedule: sched, timeZone: tz, intervalMs, run });
    } catch {
      // Skip modules that fail to load.
    }
  }

  modules.push(...loaded);
  return loaded;
}

let armed = false;
const intervals: any[] = [];
const inFlight = new Set<SecondModule>();

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
      if (typeof id?.stop === "function") id.stop();
      else { clearInterval(id); clearTimeout(id); }
    } catch {}
  }
  intervals.length = 0;
  inFlight.clear();
  armed = false;
}

export async function run(dir?: string): Promise<void> {
  if (armed) stopSecondScheduler(); // restartable: never accumulate timers
  const mods = await scan(dir);
  armed = true;
  for (const m of mods) {
    const ms = intervalMsFor(m);
    const tick = async () => {
      if (inFlight.has(m)) return; // skip overlapping tick
      inFlight.add(m);
      try { await m.run(); } catch {} finally { inFlight.delete(m); }
    };
    const id = setInterval(() => { void tick(); }, ms);
    try { id?.unref?.(); } catch {}
    intervals.push(id);
    // run once immediately
    void tick();
  }
}

export default { schedule, timeZone, parseSchedule, modules, schedules, scan, run, stopSecondScheduler };
