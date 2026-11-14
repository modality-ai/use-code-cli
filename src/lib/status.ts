/** Centralized status logic for Claude Code sessions. */

/** The values `--filter-status` accepts. */
export const SESSION_STATUSES = ["busy", "waiting", "idle"] as const;

/**
 * Adjust a session's reported status for a live (online) session: a process that
 * has been SIGSTOP'd is frozen and will never update its transcript, so report
 * it as idle instead of its stale last status.
 */
export function liveSessionStatus(stopped: boolean, originalStatus: string | undefined): string | undefined {
  return stopped ? "idle" : originalStatus;
}

/**
 * Adjust a session's waitingFor reason for a live (online) session: a process
 * that has been SIGSTOP'd is frozen and no longer waiting on anything, so clear
 * the reason (idle has none).
 */
export function liveSessionWaitingFor(stopped: boolean, originalWaitingFor: string | undefined): string | undefined {
  return stopped ? undefined : originalWaitingFor;
}

/** Rank a session status for tie-breaking (higher = more active). */
export function sessionStatusRank(status: string | undefined): number {
  const v = (status || "").toLowerCase();
  if (v === "busy") return 4;
  if (v === "waiting") return 3;
  if (v === "active") return 3;
  if (v === "idle") return 2;
  if (v === "shell") return 1;
  return 0;
}
