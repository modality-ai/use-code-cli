import { readFileSync } from "node:fs";
import { findSessions, readSessions } from "../../../../lib/sessions";
import { parseTranscript } from "../../../../lib/transcript";
import { aiTool } from "../../../../scripts/index";

/**
 * When a name is ambiguous (multiple sessions share it), pick the best candidate
 * instead of failing. Prefer live sessions, then "busy"/"active" over "shell",
 * then the most recently updated. Returns a unique target (sessionId or pid)
 * that the `session` command can resolve unambiguously, or null if none.
 */
/** Rank a session status for tie-breaking (higher = more active). */
export function sessionStatusRank(status: string | undefined): number {
  const v = (status || "").toLowerCase();
  if (v === "busy") return 4;
  if (v === "active") return 3;
  if (v === "idle") return 2;
  if (v === "shell") return 1;
  return 0;
}

/** Pick the best candidate from a list of sessions (pure). */
export function pickBestSession<T extends { online?: boolean; status?: string; updatedAt?: number }>(matches: T[]): T | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;
  const sorted = [...matches].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const r = sessionStatusRank(b.status) - sessionStatusRank(a.status);
    if (r !== 0) return r;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
  return sorted[0] ?? null;
}

/** Strip input/result/resultHtml from every tool in every entry (mutates in place). */
export function stripToolResults(entries: any[]): void {
  for (const e of entries) {
    if (!Array.isArray(e?.tools)) continue;
    for (const t of e.tools) {
      delete (t as any).input;
      delete (t as any).result;
      delete (t as any).resultHtml;
    }
  }
}

/** Find the tool with the given id across all entries; returns its data or undefined. */
export function findToolById(entries: any[], toolId: string): { input?: any; result?: string; resultHtml?: string } | undefined {
  for (const e of entries) {
    if (!Array.isArray(e?.tools)) continue;
    for (const t of e.tools) {
      if (t?.id === toolId) {
        return { input: t.input, result: t.result, resultHtml: t.resultHtml };
      }
    }
  }
  return undefined;
}

export async function resolveSessionTarget(name: string): Promise<string | null> {
  if (!name) return null;
  // Prefer the cheap live-only read; fall back to the full offline scan only
  // when no live session matches (avoids the ~2s cost on the hot path).
  let all = await readSessions(false);
  let matches = findSessions(all, name);
  if (matches.length === 0) {
    all = await readSessions(true);
    matches = findSessions(all, name);
  }
  if (matches.length === 0) return null;
  const pick = pickBestSession(matches);
  if (!pick) return null;
  return pick.pid ? String(pick.pid) : pick.sessionId;
}

export interface SessionData {
  success: boolean;
  error?: string;
  data?: {
    name?: string | null;
    transcriptPath?: string | null;
    entries?: any[];
    online?: boolean;
    status?: string | null;
  };
  message?: string;
}

// Shared by the API route (/api/session) and the page's loadData (SSR initial
// render of the transcript) so both read the session identically.
export async function fetchSessionData(name: string, options?: { includeEntries?: boolean }): Promise<SessionData> {
  const includeEntries = options?.includeEntries !== false;
  if (!name) return { success: false, error: "missing name" };

  // Lightweight status-only path: resolve the session directly from the
  // in-memory/on-disk session list without running the `session` command
  // (which reads transcript metadata / crons / monitors) — keeps the 1s poll
  // cheap.
  if (!includeEntries) {
    const libs = await import("../../../../lib/sessions");
    let all = await libs.readSessions(false);
    let matches = libs.findSessions(all, name);
    if (matches.length === 0) {
      all = await libs.readSessions(true);
      matches = libs.findSessions(all, name);
    }
    const s = pickBestSession(matches);
    if (!s) return { success: false, error: "session not found" };
    return {
      success: true,
      data: {
        name: (s.name ?? name),
        transcriptPath: null,
        entries: [],
        online: s.online ?? false,
        status: s.status ?? null,
      },
    };
  }

  const target = (await resolveSessionTarget(name)) ?? name;
  const result = (await aiTool.execute({ command: "session", target })) as {
    success?: boolean;
    data?: { transcriptPath?: string | null; name?: string | null; online?: boolean; status?: string | null };
    message?: string;
  };

  if (!result?.success) {
    return { success: false, error: result?.message || "session not found" };
  }

  const transcriptPath = result.data?.transcriptPath ?? null;
  if (!transcriptPath) {
    // No transcript yet (e.g. a freshly started session): show session info
    // with an empty entry list instead of a 404.
    return {
      success: true,
      data: {
        name: result.data?.name || name,
        transcriptPath: null,
        entries: [],
        online: result.data?.online ?? false,
        status: result.data?.status ?? null,
      },
    };
  }

  try {
    const lines = readFileSync(transcriptPath, "utf-8").split(/\n/).filter(Boolean);
    const entries = parseTranscript(lines);
    // Lazy-load tool results: strip them from the initial payload so the
    // browser only fetches a result when its "CLICK TO SEE" fold is opened.
    stripToolResults(entries);
    return {
      success: true,
      data: {
        name: result.data?.name || name,
        transcriptPath,
        entries,
        online: result.data?.online ?? false,
        status: result.data?.status ?? null,
      },
    };
  } catch {
    return { success: false, error: "cannot read transcript" };
  }
}

export interface ToolResultData {
  success: boolean;
  input?: any;
  result?: string;
  resultHtml?: string;
  error?: string;
}

export async function fetchToolResult(name: string, toolId: string): Promise<ToolResultData> {
  if (!name || !toolId) return { success: false, error: "missing name or toolId" };
  const target = (await resolveSessionTarget(name)) ?? name;
  const result = (await aiTool.execute({ command: "session", target })) as {
    success?: boolean;
    data?: { transcriptPath?: string | null };
    message?: string;
  };
  if (!result?.success) return { success: false, error: result?.message || "session not found" };
  const transcriptPath = result.data?.transcriptPath ?? null;
  if (!transcriptPath) return { success: false, error: "no transcript" };
  try {
    const lines = readFileSync(transcriptPath, "utf-8").split(/\n/).filter(Boolean);
    const entries = parseTranscript(lines);
    const tool = findToolById(entries, toolId);
    if (tool) {
      return { success: true, input: tool.input, result: tool.result, resultHtml: tool.resultHtml };
    }
    return { success: false, error: "tool not found" };
  } catch {
    return { success: false, error: "cannot read transcript" };
  }
}
