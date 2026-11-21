// Session-status watcher: detects session status changes.
// Triggered by src/scripts/scheduler-tasks/second.ts on its own cadence.

import { aiTool } from "../../scripts/index";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from "fs";
import { deliver, liveSessions, type LiveSession } from "../../lib/peer";
import { findRepliesForTarget, removeReply } from "../../lib/reply-ledger";
import { withLock } from "../../lib/file-lock";

// Declared as a 6-field (seconds) cron expression for documentation/simulation
// purposes; Bun.cron is minute-level (5 fields).
export const schedule: string = "*/30 * * * * *";
export const timeZone: string = "UTC";

function stateDir(): string { return join(process.env.HOME || homedir(), ".use-code-cli"); }
function statusFile(): string { return join(stateDir(), "last-statuses.json"); }

function loadPersisted(): Map<string, string> | null {
  try {
    if (!existsSync(statusFile())) return null;
    const raw = JSON.parse(readFileSync(statusFile(), "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(raw)) m.set(k, String(v));
    return m.size ? m : null;
  } catch {
    return null;
  }
}

function persist(map: Map<string, string>): void {
  try {
    if (!existsSync(stateDir())) mkdirSync(stateDir(), { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of map) obj[k] = v;
    const tmp = `${statusFile()}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, statusFile());
  } catch (e) {
    console.error("session-status: persist failed", e);
  }
}
type SessionRow = { sessionId?: string; status?: string; name?: string; cwd?: string };

export interface SessionStatusDeps {
  aiTool?: { execute: (args: unknown) => Promise<unknown> };
  liveSessions?: () => Promise<LiveSession[]>;
  deliver?: (session: LiveSession, message: string, msgId?: string) => Promise<string>;
  findRepliesForTarget?: (targetSessionId: string) => Promise<any[]>;
  removeReply?: (inReplyTo: string, targetSessionId: string) => Promise<any>;
}

let lastStatuses: Map<string, string> | null = null;

/** Reset internal state (test helper). */
export function resetSessionStatusState(): void {
  lastStatuses = null;
  try { if (existsSync(statusFile())) writeFileSync(statusFile(), "{}"); } catch {}
}

function basenameOf(cwd: string | undefined): string {
  if (!cwd) return "";
  const parts = String(cwd).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : "";
}

/** Detect session status changes by comparing the current snapshot to the previous one. */
export async function run(deps?: SessionStatusDeps): Promise<void> {
  const aiToolFn = deps?.aiTool ?? aiTool;
  const liveSessionsFn = deps?.liveSessions ?? liveSessions;
  const deliverFn = deps?.deliver ?? deliver;
  const findRepliesFn = deps?.findRepliesForTarget ?? findRepliesForTarget;
  const removeReplyFn = deps?.removeReply ?? removeReply;

  const lockPath = join(stateDir(), "session-status.lock");
  try {
    await withLock(lockPath, async () => {
    const res: unknown = await aiToolFn.execute({ command: "sessions", json: true } as { command: string; json: boolean });
    const r = res as { data?: unknown };
    const rows: SessionRow[] = Array.isArray(r.data) ? (r.data as SessionRow[]) : [];
    const current = new Map<string, string>();
    const rowById = new Map<string, SessionRow>();
    for (const r of rows) {
      if (r?.sessionId) {
        current.set(r.sessionId, r.status ?? "");
        rowById.set(r.sessionId, r);
      }
    }

    if (lastStatuses === null) lastStatuses = loadPersisted();
    console.log(`session-status: ${current.size} session(s) tracked${lastStatuses ? "" : " (baseline)"}`);
    if (lastStatuses) {
      for (const [id, status] of current) {
        const prev = lastStatuses.get(id);
        if (prev !== undefined && prev !== status) {
          console.log(`session-status: ${id} ${prev} -> ${status} @ ${new Date().toISOString()}`);
        }
        // Trigger only on busy -> idle transition.
        if (prev === "busy" && status === "idle") {
          try {
            const session = rowById.get(id)!;
            const name = id; // we should always send session id
            const message = `${name} is idle now`;
            const replies = await findRepliesFn(id);
            const live = await liveSessionsFn();

            if (Array.isArray(replies) && replies.length > 0) {
              let fallThrough = false;
              for (const rec of replies) {
                const sender = rec?.senderSessionId
                  ? live.find((s) => s.sessionId === rec.senderSessionId)
                  : undefined;
                if (sender) {
                  try {
                    await deliverFn(sender, message);
                  } catch {
                    // best-effort
                  }
                  try {
                    await removeReplyFn(rec.inReplyTo, id);
                  } catch {
                    // best-effort
                  }
                } else {
                  fallThrough = true;
                }
              }
              if (fallThrough) {
                await alertPo(session, live, deliverFn, aiToolFn, message);
              }
            } else {
              await alertPo(session, live, deliverFn, aiToolFn, message);
            }
          } catch {
            // never throw
          }
        }
      }
      for (const id of lastStatuses.keys()) {
        if (!current.has(id)) {
          console.log(`session-status: ${id} removed`);
        }
      }
    }

    lastStatuses = current;
    persist(current);
    }, { staleMs: 60000 });
  } catch {
    // Swallow: status polling must never break the host process.
  }
}

async function alertPo(
  session: SessionRow,
  live: LiveSession[],
  deliverFn: (session: LiveSession, message: string, msgId?: string) => Promise<string>,
  aiToolFn: { execute: (args: unknown) => Promise<unknown> },
  message: string,
): Promise<void> {
  try {
    const res: any = await aiToolFn.execute({ command: "project", target: session.cwd } as any);
    const po = res?.data?.po ?? `po-${basenameOf(session.cwd)}`;
    const poSession = live.find((s) => (s.name === po || s.sessionId === po) && s.sessionId !== session.sessionId);
    if (poSession) {
      try {
        await deliverFn(poSession, message);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}

export default { schedule, timeZone, run, resetSessionStatusState };
