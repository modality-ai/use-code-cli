// Example second-granularity task body. Imported by the scheduler-tasks wrapper.
// Declared as a 6-field (seconds) cron expression for documentation/simulation
// purposes; the second-granularity runner executes via intervalMs, since
// Bun.cron is minute-level (5 fields).
export const schedule: string = "* * * * * *";
export const timeZone: string = "Asia/Tokyo";

export async function run(): Promise<void> {
  // console.log("second task tick", new Date().toISOString());
}
