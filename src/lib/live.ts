import { statSync, watch, type FSWatcher } from "node:fs";
import { PROJECTS_DIR, SESSIONS_DIR } from "./sessions";
import { cleanPrompt } from "./prompt";
import { aiTool } from "../scripts/index";

/** Clean cross-session noise from a session's last prompt. */
export function cleanSession(s: any) {
  if (s && typeof s.lastPrompt === "string") {
    return { ...s, lastPrompt: cleanPrompt(s.lastPrompt) };
  }
  return s;
}

export interface LiveSession {
  name?: string;
  sessionId?: string;
  hero?: string;
  status?: string;
  cwd?: string;
  lastPrompt?: string;
}

/** Fetch the current sessions list (cleaned). */
export async function fetchSessions(): Promise<LiveSession[]> {
  const result = (await aiTool.execute({ command: "sessions" })) as { success?: boolean; data?: unknown[] };
  return Array.isArray(result?.data) ? (result.data.map(cleanSession) as LiveSession[]) : [];
}

export type SessionsListener = (sessions: LiveSession[]) => void;

const listeners = new Set<SessionsListener>();
const watchers: FSWatcher[] = [];
let debounce: ReturnType<typeof setTimeout> | null = null;

function notify() {
  if (debounce) clearTimeout(debounce);
  // Small debounce: bursts of transcript writes should trigger one refresh.
  debounce = setTimeout(async () => {
    if (listeners.size === 0) return;
    const sessions = await fetchSessions();
    for (const l of listeners) {
      try { l(sessions); } catch { /* client gone */ }
    }
  }, 400);
}

function ensureWatchers() {
  if (watchers.length) return;
  for (const dir of [PROJECTS_DIR, SESSIONS_DIR]) {
    try {
      if (statSync(dir).isDirectory()) {
        const w = watch(dir, { recursive: true } as any, notify);
        watchers.push(w);
      }
    } catch {
      // Watcher unavailable on this platform: SSE clients still get the
      // initial snapshot and can use the manual Refresh button.
    }
  }
}

export function subscribeSessions(listener: SessionsListener): () => void {
  ensureWatchers();
  listeners.add(listener);
  // immediate initial snapshot for this subscriber
  fetchSessions().then(list => {
    if (listeners.has(listener)) listener(list);
  }).catch(() => {});
  return () => { listeners.delete(listener); };
}
