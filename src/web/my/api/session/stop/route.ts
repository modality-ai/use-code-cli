import { readSessions, findSessionsFuzzy, type SessionInfo } from "../../../../../lib/sessions";
import { readJsonBody } from "../../../../../lib/web/request";
import { pickBestSession } from "../../../session/[name]/session-data";
import { aiTool } from "../../../../../scripts/index";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });

  let all = await readSessions(false);
  let matches = findSessionsFuzzy(all, name);
  if (matches.length === 0) {
    all = await readSessions(true);
    matches = findSessionsFuzzy(all, name);
  }
  const s = matches.length === 0 ? null : pickBestSession(matches);
  if (!s) return Response.json({ success: false, error: "session not found" }, { status: 404 });
  if (!s.online) return Response.json({ success: false, error: "session is offline; cannot stop it" }, { status: 409 });

  const result = (await aiTool.execute({ command: "session", target: name, stop: true })) as {
    success?: boolean;
    message?: string;
    data?: { pid?: number; name?: string };
  };
  if (!result?.success) {
    return Response.json({ success: false, error: result?.message || "stop failed" }, { status: 500 });
  }

  const data = result.data as { pid?: number; name?: string } | undefined;
  return Response.json({
    success: true,
    pid: data?.pid ?? s.pid,
    name: data?.name ?? s.name ?? name,
  });
}
