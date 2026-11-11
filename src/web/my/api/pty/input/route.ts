import { getJob } from "../jobs";
import { readJsonBody } from "../../../../../lib/web/request";

// Send keystrokes to a live PTY job spawned by the project exec endpoint.
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const jobId = String(body?.jobId || "").trim();
  const data = body?.data;
  if (!jobId || typeof data !== "string") {
    return Response.json({ success: false, error: "missing jobId or data" }, { status: 400 });
  }
  // A giant paste is written to the subprocess terminal in one call — cap it.
  if (data.length > 65_536) {
    return Response.json({ success: false, error: "data too large" }, { status: 413 });
  }
  const job = getJob(jobId);
  if (!job) {
    return Response.json({ success: false, error: "job not found or already exited" }, { status: 404 });
  }
  try {
    job.proc.terminal.write(data);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}
