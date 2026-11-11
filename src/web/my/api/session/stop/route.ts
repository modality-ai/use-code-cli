import { readSessions, findSessions, type SessionInfo } from "../../../../../lib/sessions";
import { readJsonBody } from "../../../../../lib/web/request";
import { pickBestSession, sessionStatusRank } from "../../../session/[name]/session-data";

// Bounded wait for the session to actually return to idle after SIGINT.
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
  let matches = findSessions(all, name);
  if (matches.length === 0) {
    all = await readSessions(true);
    matches = findSessions(all, name);
  }
  return matches.length === 0 ? null : pickBestSession(matches);
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });

  const s = await resolveSession(name);
  if (!s) return Response.json({ success: false, error: "session not found" }, { status: 404 });
  if (!s.online) return Response.json({ success: false, error: "session is offline; cannot stop it" }, { status: 409 });

  // Interrupt the current turn (like Ctrl+C) without killing the session.
  // SIGINT is the standard interrupt signal; the session process handles it by
  // pausing the active work and returning to idle. We never SIGTERM/SIGKILL here.
  try {
    process.kill(s.pid, "SIGINT");
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
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
  return Response.json({ success: true, paused, pid: s.pid, name: s.name ?? name, status: current?.status || "idle" });
}
