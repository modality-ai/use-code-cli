import { readSessions, findSessionsFuzzy, type SessionInfo } from "../../../../../lib/sessions";
import { readJsonBody } from "../../../../../lib/web/request";
import { pickBestSession, sessionStatusRank } from "../../../session/[name]/session-data";
import { aiTool } from "../../../../../scripts/index";

// Bounded wait for the session to actually return to idle after the interrupt.
const PAUSE_VERIFY_TIMEOUT_MS = 3000;
const PAUSE_POLL_INTERVAL_MS = 150;

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
  let all = await readSessions(false);
  let matches = findSessionsFuzzy(all, name);
  if (matches.length === 0) {
    all = await readSessions(true);
    matches = findSessionsFuzzy(all, name);
  }
  return matches.length === 0 ? null : pickBestSession(matches);
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });

  const s = await resolveSession(name);
  if (!s) return Response.json({ success: false, error: "session not found" }, { status: 404 });
  if (!s.online) return Response.json({ success: false, error: "session is offline; cannot pause it" }, { status: 409 });

  // Freeze the session's process (SIGSTOP) without killing it, via the
  // shared `session --pause` command run in-process (no subprocess). The
  // process stops updating its transcript, so we treat it as paused/idle
  // immediately below. We never SIGTERM/SIGKILL here.
  const result = (await aiTool.execute({ command: "session", target: name, pause: true })) as {
    success?: boolean;
    message?: string;
    data?: { pid?: number; name?: string; pause?: string };
  };
  if (!result?.success) {
    return Response.json({ success: false, error: result?.message || "pause failed" }, { status: 500 });
  }

  // For a SIGSTOP-based pause the process is frozen and will never update its
  // transcript, so treat it as paused/idle immediately instead of polling.
  if (result.data?.pause === "sigstop") {
    return Response.json({
      success: true,
      paused: true,
      pid: result.data?.pid ?? s.pid,
      name: result.data?.name ?? s.name ?? name,
      status: "idle",
    });
  }

  // Verify instead of assuming: poll the session until it reports it left its
  // active state, up to the timeout. `paused` reflects what actually happened.
  const deadline = Date.now() + PAUSE_VERIFY_TIMEOUT_MS;
  let current: SessionInfo | null = s;
  while (Date.now() < deadline && !hasReturnedToIdle(current)) {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_POLL_INTERVAL_MS));
    current = await resolveSession(name);
  }

  const paused = hasReturnedToIdle(current);
  return Response.json({
    success: true,
    paused,
    pid: result.data?.pid ?? s.pid,
    name: result.data?.name ?? s.name ?? name,
    status: current?.status || "idle",
  });
}
