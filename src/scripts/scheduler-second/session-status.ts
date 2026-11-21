// Session-status watcher: detects session status changes.
// Triggered by src/scripts/scheduler-tasks/second.ts on its own cadence.

import { aiTool } from "../../scripts/index";

// Declared as a 6-field (seconds) cron expression for documentation/simulation
// purposes; Bun.cron is minute-level (5 fields).
export const schedule: string = "*/30 * * * * *";
export const timeZone: string = "UTC";

type SessionRow = { sessionId?: string; status?: string; name?: string };

let lastStatuses: Map<string, string> | null = null;

/** Detect session status changes by comparing the current snapshot to the previous one. */
export async function run(): Promise<void> {
  try {
    const res: any = await aiTool.execute({ command: "sessions", json: true } as any);
    const rows: SessionRow[] = Array.isArray(res?.data) ? res.data : [];
    const current = new Map<string, string>();
    for (const r of rows) {
      if (r?.sessionId) current.set(r.sessionId, r.status ?? "");
    }

    console.log(`session-status: ${current.size} session(s) tracked${lastStatuses ? "" : " (baseline)"}`);
    if (lastStatuses) {
      for (const [id, status] of current) {
        const prev = lastStatuses.get(id);
        if (prev !== undefined && prev !== status) {
          // Status changed for this session.
          console.log(`session-status: ${id} ${prev} -> ${status}`);
        }
      }
      for (const id of lastStatuses.keys()) {
        if (!current.has(id)) {
          console.log(`session-status: ${id} removed`);
        }
      }
    }

    lastStatuses = current;
  } catch {
    // Swallow: status polling must never break the host process.
  }
}

export default { schedule, timeZone, run };
