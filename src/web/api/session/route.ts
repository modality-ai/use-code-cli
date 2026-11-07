import { readFileSync } from "node:fs";
import { parseTranscript } from "../../../lib/transcript";
import { aiTool } from "../../../scripts/index";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "";
  if (!name) {
    return Response.json({ success: false, error: "missing name" }, { status: 400 });
  }

  const result = (await aiTool.execute({ command: "session", target: name })) as {
    success?: boolean;
    data?: { transcriptPath?: string | null; name?: string | null; online?: boolean; status?: string | null };
    message?: string;
  };

  if (!result?.success || !result.data?.transcriptPath) {
    return Response.json({ success: false, error: result?.message || "session not found" }, { status: 404 });
  }

  const transcriptPath = result.data.transcriptPath;
  try {
    const lines = readFileSync(transcriptPath, "utf-8").split(/\n/).filter(Boolean);
    const entries = parseTranscript(lines);
    return Response.json({
      success: true,
      data: { name: result.data.name || name, transcriptPath, entries, online: result.data.online ?? false, status: result.data.status ?? null },
    });
  } catch (e) {
    return Response.json({ success: false, error: "cannot read transcript" }, { status: 500 });
  }
}
