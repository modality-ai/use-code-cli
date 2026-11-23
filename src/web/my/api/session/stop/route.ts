import { readSessions, findSessionsFuzzy } from "../../../../../lib/sessions";
import { readJsonBody } from "../../../../../lib/web/request";
import { pickBestSession } from "../../../session/[name]/session-data";
import { aiTool } from "../../../../../scripts/index";

function statusForFailure(message: string): number {
  const m = (message || "").toLowerCase();
  // The route targets a pid, so a numeric no-match means it exited after resolution.
  if (/no session matches "\d+"/.test(m)) return 409;
  if (/not found|no session matches/.test(m)) return 404;
  if (/no such process|esrch|offline|ambiguous|already gone|already stopped/.test(m)) return 409;
  return 500;
}

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

  let result: { success?: boolean; message?: string; data?: { pid?: number; name?: string; sessionId?: string } };
  try {
    result = (await aiTool.execute({ command: "session", target: String(s.pid), stop: true })) as typeof result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = statusForFailure(message);
    return Response.json({ success: false, error: message }, { status });
  }

  if (!result?.success) {
    const message = result?.message || "stop failed";
    return Response.json({ success: false, error: message }, { status: statusForFailure(message) });
  }

  const data = result.data as { pid?: number; name?: string; sessionId?: string } | undefined;
  return Response.json({
    success: true,
    pid: data?.pid ?? s.pid,
    name: data?.name ?? s.name ?? name,
    sessionId: data?.sessionId ?? s.sessionId,
  });
}
