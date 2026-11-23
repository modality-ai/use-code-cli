import { aiTool } from "../../../../../scripts/index";
import { readJsonBody } from "../../../../../lib/web/request";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const result = (await aiTool.execute({
    command: "pty-input",
    jobId: String(body?.jobId || "").trim(),
    data: body?.data,
  })) as { success?: boolean; message?: string; data?: { statusCode?: number } };

  const status = result?.data?.statusCode ?? (result?.success ? 200 : 500);
  if (!result?.success) {
    return Response.json({ success: false, error: result?.message || "request failed" }, { status });
  }
  return Response.json({ success: true }, { status });
}
