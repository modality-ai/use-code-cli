import { readSessions, findSessionsFuzzy, type SessionInfo } from "../../../../../lib/sessions";
import { readJsonBody } from "../../../../../lib/web/request";
import { pickBestSession, sessionStatusRank } from "../../../session/[name]/session-data";
import { aiTool } from "../../../../../scripts/index";

// Pure predicate: a session has returned to idle when it went offline or its
// status dropped below "active" (rank >= 3 means busy/active work in flight).
// Typed over the fields it reads so tests can pass minimal stand-ins.
export function hasReturnedToIdle(
  session: { online?: boolean; status?: string | null } | null,
): boolean {
  if (!session || !session.online) return true;
  return sessionStatusRank(session.status ?? undefined) < 3;
}

async function resolveSession(name: string): Promise<SessionInfo | null> {
  console.log("[pause] resolveSession: name=%s (live)", name);
  let all = await readSessions(false);
  let matches = findSessionsFuzzy(all, name);
  if (matches.length === 0) {
    console.log("[pause] resolveSession: no live match, retrying all sessions");
    all = await readSessions(true);
    matches = findSessionsFuzzy(all, name);
  }
  const resolved = matches.length === 0 ? null : pickBestSession(matches);
  console.log("[pause] resolveSession: resolved=%s", resolved ? `${resolved.name ?? resolved.sessionId} pid=${resolved.pid} online=${resolved.online} status=${resolved.status}` : "null");
  return resolved;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });
  console.log("[pause] POST: name=%s", name);

  const s = await resolveSession(name);
  if (!s) {
    console.log("[pause] session not found: %s", name);
    return Response.json({ success: false, error: "session not found" }, { status: 404 });
  }
  if (!s.online) {
    console.log("[pause] session offline, cannot pause: %s", name);
    return Response.json({ success: false, error: "session is offline; cannot pause it" }, { status: 409 });
  }

  // Freeze the session's process (SIGSTOP) without killing it. Route through
  // the shared CLI command so the pause path matches `use-code-cli session --pause`.
  const result = (await aiTool.execute({ command: "session", target: name, pause: true })) as {
    success?: boolean;
    message?: string;
    data?: { pid?: number; name?: string; pause?: string };
  };
  console.log("[pause] pause result: success=%s message=%s", result?.success, result?.message);
  if (!result?.success) {
    return Response.json({ success: false, error: result?.message || "pause failed" }, { status: 500 });
  }

  const data = result.data as { pid?: number; name?: string; pause?: string } | undefined;

  // For a SIGSTOP-based pause the process is frozen and will never update its
  // transcript, so treat it as paused/idle immediately instead of polling.
  if (data?.pause === "sigstop") {
    return Response.json({
      success: true,
      paused: true,
      pid: data?.pid ?? s.pid,
      name: data?.name ?? s.name ?? name,
      status: "idle",
    });
  }

  // Non-sigstop pause isn't produced by the current `session --pause` path; treat
  // the request as successful with the session's reported status.
  return Response.json({
    success: true,
    paused: true,
    pid: data?.pid ?? s.pid,
    name: data?.name ?? s.name ?? name,
    status: s.status || "idle",
  });
}
