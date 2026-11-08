import { sseResponse } from "../../../../lib/sse";
import { fetchSessions } from "../../../../lib/live";
import { PROJECTS_DIR, SESSIONS_DIR } from "../../../../lib/sessions";

/**
 * SSE stream of the live sessions list.
 * Pushes the full sessions snapshot on connect and whenever the underlying
 * session/project directories change on disk (debounced, rate-capped — see lib/sse).
 */
export async function GET(request: Request): Promise<Response> {
  return sseResponse(request, {
    watchDirs: [PROJECTS_DIR, SESSIONS_DIR],
    minIntervalMs: 1000,
    payload: async () => {
      const sessions = await fetchSessions();
      return { success: true, data: sessions };
    },
  });
}
