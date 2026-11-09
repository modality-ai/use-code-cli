import { readSessions, findSessions } from "../../../../lib/sessions";
import { pickBestSession } from "../../../session/[name]/session-data";

export async function POST(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }
  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });

  let all = await readSessions(false);
  let matches = findSessions(all, name);
  if (matches.length === 0) {
    all = await readSessions(true);
    matches = findSessions(all, name);
  }
  const s = matches.length === 0 ? null : pickBestSession(matches);
  if (!s) return Response.json({ success: false, error: "session not found" }, { status: 404 });
  if (!s.online) return Response.json({ success: false, error: "session is offline; cannot stop it" }, { status: 409 });

  try {
    process.kill(s.pid, "SIGINT");
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
  return Response.json({ success: true, pid: s.pid, name: s.name ?? name });
}
