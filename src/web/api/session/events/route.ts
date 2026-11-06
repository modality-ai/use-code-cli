import { statSync, readFileSync as readFile } from "node:fs";
import { basename, dirname } from "node:path";
import { sseResponse } from "../../../../lib/sse";
import { parseTranscript } from "../../../../lib/transcript";
import { aiTool } from "../../../../scripts/index";

/**
 * SSE stream of live transcript entries for one session.
 * Pushes the full entries payload on connect and whenever the transcript file
 * changes on disk (debounced, rate-capped, skip-unchanged — see lib/sse).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "";
  if (!name) {
    return Response.json({ success: false, error: "missing name" }, { status: 400 });
  }

  const result = (await aiTool.execute({ command: "session", target: name })) as {
    success?: boolean;
    data?: { transcriptPath?: string | null; name?: string | null };
    message?: string;
  };

  if (!result?.success || !result.data?.transcriptPath) {
    return Response.json({ success: false, error: result?.message || "session not found" }, { status: 404 });
  }

  const transcriptPath = result.data.transcriptPath;
  let lastSize = -1;

  return sseResponse(request, {
    watchDirs: [dirname(transcriptPath)],
    // Watch the parent directory (per-file watches are unreliable under Bun
    // on macOS) and filter events down to this transcript's basename.
    watchFilter: (filename) => !filename || filename === basename(transcriptPath),
    minIntervalMs: 1000,
    unchanged: () => {
      try { return statSync(transcriptPath).size === lastSize; } catch { return true; }
    },
    payload: async () => {
      lastSize = statSync(transcriptPath).size;
      const lines = readFile(transcriptPath, "utf-8").split(/\n/).filter(Boolean);
      const entries = parseTranscript(lines);
      return { name, transcriptPath, entries };
    },
  });
}
