import { watch, type FSWatcher } from "node:fs";

/** MIME/headers for every SSE response produced here. */
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

export interface SsePushOptions {
  /** Build the payload to push (called once on connect, then on every change). */
  payload: () => Promise<unknown> | unknown;
  /** Directories to watch for filesystem changes (transcript/session write bursts). */
  watchDirs?: string[];
  /** Optional per-event filename filter (receives null when not reported). */
  watchFilter?: (filename: string | null) => boolean;
  /** Return true when nothing changed since the last push (skips the work entirely). */
  unchanged?: () => boolean;
  /** Minimum ms between full pushes; writes arriving sooner coalesce into one trailing push. */
  minIntervalMs?: number;
  /** Debounce window for write bursts (default 300ms). */
  debounceMs?: number;
}

/**
 * Build a Server-Sent-Events Response that pushes a payload on connect and
 * re-pushes whenever the watched directories change on disk.
 *
 * Shared by /api/session/events and /api/sessions/events: initial push,
 * directory watching, burst debounce, skip-unchanged, rate cap with a
 * trailing catch-up push, and abort cleanup — all in one place.
 */
export function sseResponse(request: Request, options: SsePushOptions): Response {
  const { payload, watchDirs = [], watchFilter, unchanged, minIntervalMs = 0, debounceMs = 300 } = options;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      let trailing: ReturnType<typeof setTimeout> | null = null;
      let lastPush = 0;
      const watchers: FSWatcher[] = [];

      const doPush = async () => {
        if (closed) return;
        if (unchanged?.()) return;
        // Rate-limited: schedule exactly one trailing push instead of piling up.
        const wait = Math.max(0, lastPush + minIntervalMs - Date.now());
        if (wait > 0) {
          if (!trailing) {
            trailing = setTimeout(() => { trailing = null; doPush(); }, wait);
          }
          return;
        }
        lastPush = Date.now();
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(await payload())}\n\n`));
        } catch {
          // payload raced with a write (transcript rebuild mid-read); next event retries
        }
      };

      const schedule = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(doPush, debounceMs);
      };

      for (const dir of watchDirs) {
        try {
          const w = watch(dir, (_event: string | null, filename: string | null) => {
            if (!watchFilter || watchFilter(filename)) schedule();
          });
          watchers.push(w);
        } catch {
          // fs.watch unavailable for this dir: clients keep the initial snapshot
        }
      }

      // immediate initial snapshot
      doPush();

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (debounce) clearTimeout(debounce);
        if (trailing) clearTimeout(trailing);
        for (const w of watchers) w.close();
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
