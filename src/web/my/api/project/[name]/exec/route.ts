import { aiTool } from "../../../../../../scripts/index";
import { readJsonBody } from "../../../../../../lib/web/request";
import { projectRunErrorStatus } from "../../../../../../lib/project-run";

function commandErrorResponse(message: string, statusCode?: number): Response {
  return Response.json(
    { success: false, error: message },
    { status: statusCode ?? projectRunErrorStatus(message) },
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  const command = String(body?.command || "").trim();
  const background = Boolean(body?.background);
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });
  if (!command) return Response.json({ success: false, error: "missing command" }, { status: 400 });

  if (background) {
    const result = (await aiTool.execute({
      command: "project-run",
      project: name,
      cmd: command,
      detach: true,
      keepAlive: true,
    })) as {
      success?: boolean;
      message?: string;
      data?: { cwd?: string; jobId?: string; pid?: number; log?: string; statusCode?: number };
    };

    if (!result?.success) {
      return commandErrorResponse(String(result?.message || "command failed"), result?.data?.statusCode);
    }

    const data = result.data || {};
    return Response.json({
      success: true,
      background: true,
      cwd: data.cwd,
      jobId: data.jobId,
      pid: data.pid,
      log: data.log,
    });
  }

  const result = (await aiTool.execute({
    command: "project-run-stream",
    project: name,
    cmd: command,
    detach: false,
  })) as {
    success?: boolean;
    message?: string;
    data?: { cwd?: string; jobId?: string; pid?: number; stream?: ReadableStream<Uint8Array>; statusCode?: number };
  };

  if (!result?.success) {
    return commandErrorResponse(String(result?.message || "command failed"), result?.data?.statusCode);
  }

  const cwd = result.data?.cwd || "";
  const jobId = result.data?.jobId || "";
  const stream = result.data?.stream;
  if (!stream) {
    return Response.json({ success: false, error: "no stream" }, { status: 500 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Cwd": encodeURIComponent(cwd),
      "X-Job-Id": jobId,
    },
  });
}
