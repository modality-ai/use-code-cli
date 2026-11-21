// Cloud-Scheduler-style cron runner using Bun's built-in runtime cron
// (Bun.cron). Discovers task modules under src/scripts/scheduler-tasks/.
// Bun.cron is 5-field (minute granularity); sub-minute cadences use the
// intervalMs fallback.

import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface ScheduledTask {
  name: string;
  run: () => void | Promise<void>;
  schedule?: string;
  timeZone?: string;
  intervalMs?: number;
}

/** Compute the next fire time for a 5-field cron schedule. */
export function nextRun(schedule: string, timeZone?: string, from: Date = new Date()): Date | null {
  try {
    const opts = timeZone ? { tz: timeZone } : {};
    const next = Bun.cron.parse(schedule, from, opts as any);
    return next ?? null;
  } catch {
    return null;
  }
}

const timers = new Map<ScheduledTask, any>();

function arm(task: ScheduledTask): void {
  if (task.schedule) {
    const opts = task.timeZone ? { tz: task.timeZone } : {};
    const job = Bun.cron(task.schedule, () => {
      void runTask(task);
    }, opts as any);
    job.unref?.();
    timers.set(task, job);
  } else if (typeof task.intervalMs === "number" && task.intervalMs > 0) {
    const timer = setInterval(() => {
      void runTask(task);
    }, task.intervalMs);
    timer.unref?.();
    timers.set(task, timer);
  }
}

export function discoverTaskModules(dir: string = join(import.meta.dir, "..", "scripts", "scheduler-tasks")): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export async function loadTasks(dir?: string): Promise<ScheduledTask[]> {
  const files = discoverTaskModules(dir);
  const loaded: ScheduledTask[] = [];
  for (const file of files) {
    try {
      const mod: any = await import(file);
      const run = typeof mod?.run === "function" ? mod.run : typeof mod?.default === "function" ? mod.default : null;
      if (run) {
        loaded.push({
          name: file,
          run,
          schedule: typeof mod?.schedule === "string" ? mod.schedule : undefined,
          timeZone: typeof mod?.timeZone === "string" ? mod.timeZone : undefined,
          intervalMs: typeof mod?.intervalMs === "number" ? mod.intervalMs : undefined,
        });
      }
    } catch {
      // Skip modules that fail to load.
    }
  }
  return loaded;
}

export async function runTask(task: ScheduledTask): Promise<void> {
  try {
    await task.run();
  } catch {
    // Swallow; task handles its own diagnostics.
  }
}

export async function runTasks(tasks: ScheduledTask[]): Promise<void> {
  for (const t of tasks) await runTask(t);
}

export async function startScheduler(intervalMs: number = 60_000, dir?: string): Promise<ScheduledTask[]> {
  const tasks = await loadTasks(dir);
  stopScheduler();
  for (const t of tasks) arm(t);
  return tasks;
}

export function stopScheduler(): void {
  for (const [t, timer] of timers) {
    try {
      if (typeof timer?.stop === "function") timer.stop();
      else {
        clearTimeout(timer);
        clearInterval(timer);
      }
    } catch {}
  }
  timers.clear();
}

