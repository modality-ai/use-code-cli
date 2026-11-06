import { sseResponse } from "../../../../lib/sse";
import { subscribeSessions } from "../../../../lib/live";

/**
 * SSE stream of the live sessions list.
 * The watcher hub lives in lib/live (fs.watch over ~/.claude/projects and
 * ~/.claude/sessions with its own listeners). We consume that signal here and
 * push full snapshots (no client polling).
 */
export async function GET(request: Request): Promise<Response> {
  const enc = new TextEncoder();
  return sseResponse(request, {
    payload: () => new Promise<unknown>((resolve) => {
      // next change-notification from the live hub = fresh snapshot
      const unsubscribe = subscribeSessions((sessions) => {
        unsubscribe();
        resolve({ success: true, data: sessions });
      });
    }),
  });
}
