// Example cron task module. Copy this file to create a new scheduled task.
// The runner (src/runner/scheduler.ts) discovers any .ts/.js file in this
// directory that exports a `run` function and schedules it per `schedule`.

// Standard 5-field cron: "minute hour day-of-month month day-of-week".
// (Bun.cron does not support seconds; use intervalMs fallback for sub-minute.)
export const schedule = "* * * * *";

// Optional IANA time zone; defaults to the system zone.
export const timeZone = "UTC";

// The work to perform on each tick.
export async function run(): Promise<void> {
  // Replace with your task logic.
  // console.log("example task tick", new Date().toISOString());
}
