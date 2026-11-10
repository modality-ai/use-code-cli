import { readFileSync as readFile } from "node:fs";
import { basename, dirname } from "node:path";
import { sseResponse } from "../../../../../lib/sse";
import { parseTranscript } from "../../../../../lib/transcript";
import { aiTool } from "../../../../../scripts/index";
import { fetchSessionData, resolveSessionTarget } from "../../../session/[name]/session-data";

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

  const target = (await resolveSessionTarget(name)) ?? name;
  const result = (await aiTool.execute({ command: "session", target })) as {
    success?: boolean;
    data?: { transcriptPath?: string | null; name?: string | null };
    message?: string;
  };

  if (!result?.success) {
    return Response.json({ success: false, error: result?.message || "session not found" }, { status: 404 });
  }
  if (!result.data?.transcriptPath) {
    // No transcript file to watch yet: nothing to stream.
    return new Response(null, { status: 204 });
  }

  const transcriptPath = result.data.transcriptPath;

  return sseResponse(request, {
    watchDirs: [dirname(transcriptPath)],
    // Watch the parent directory (per-file watches are unreliable under Bun
    // on macOS) and filter events down to this transcript's basename.
    watchFilter: (filename) => !filename || filename === basename(transcriptPath),
    minIntervalMs: 1000,
    payload: async () => {
      const statusResult = await fetchSessionData(name, { includeEntries: false });
      let entries: any[] = [];
      try {
        const lines = readFile(transcriptPath, "utf-8").split(/\n/).filter(Boolean);
        entries = parseTranscript(lines);
      } catch {}
      return {
        success: statusResult.success,
        error: statusResult.error,
        data: {
          name: statusResult.data?.name || name,
          transcriptPath,
          entries,
          online: statusResult.data?.online ?? false,
          status: statusResult.data?.status ?? null,
        },
      };
    },
  });
}
