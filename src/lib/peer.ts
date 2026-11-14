import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import {
  readSessionsLive,
  SESSIONS_DIR,
  sessionLabel,
  type SessionInfo,
} from "./sessions";

export interface LiveSession {
  pid: number;
  sessionId: string;
  name?: string;
  /** "busy" | "idle" while the session is running. */
  status?: string;
  cwd: string;
  messagingSocketPath?: string;
}

/** Cap on the ancestor walk — the chain is short in practice. */
const MAX_ANCESTOR_DEPTH = 16;

/**
 * Pids of this process's ancestors, nearest first.
 *
 * A Claude Code session is not always the direct parent: a `!` command runs
 * through a shell, so `process.ppid` would point at that shell instead. Walking
 * the chain finds the session that actually launched this CLI.
 */
export function ancestorPids(): Set<number> {
  const pids = new Set<number>();
  let pid = process.ppid;
  while (pid > 1 && !pids.has(pid) && pids.size < MAX_ANCESTOR_DEPTH) {
    pids.add(pid);
    try {
      const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      pid = Number.parseInt(out, 10);
    } catch {
      // `ps` is unavailable (e.g. Windows); the collected pids are all we get.
      break;
    }
  }
  return pids;
}

/** Every live session — session files tagged online by `readSessionsLive`. */
export async function liveSessions(): Promise<LiveSession[]> {
  return (await readSessionsLive()).filter((s) => s.online);
}

/**
 * The live session that launched this CLI — the nearest ancestor pid that is
 * registered as a session. Undefined when the caller is not a Claude session
 * (a plain shell, CI, or a test harness without one).
 */
export async function currentSession(
  sessions?: LiveSession[],
): Promise<LiveSession | undefined> {
  const ancestors = ancestorPids();
  const list = sessions ?? (await liveSessions());
  for (const pid of ancestors) {
    const match = list.find((s) => s.pid === pid);
    if (match) return match;
  }
  return undefined;
}

/** The peer token lives in ~/.claude/sessions/<pid>.<hash>.key */
async function peerToken(pid: number): Promise<string | undefined> {
  const files = (await readdir(SESSIONS_DIR)).filter(
    (f) => f.startsWith(`${pid}.`) && f.endsWith(".key"),
  );
  for (const f of files) {
    try {
      const k = JSON.parse(await readFile(join(SESSIONS_DIR, f), "utf8"));
      if (typeof k.peerToken === "string") return k.peerToken;
    } catch {
      // try next
    }
  }
  return undefined;
}

function writeLine(sock: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = createConnection({ path: sock });
    c.setTimeout(5000, () => {
      c.destroy();
      reject(new Error(`Timed out sending to ${sock}`));
    });
    c.on("error", reject);
    c.on("connect", () => {
      c.write(payload);
      setTimeout(() => c.end(), 150);
    });
    c.on("close", () => resolve());
  });
}

/**
 * The socket's control-protocol interrupt frame: it stops the session's active
 * turn while leaving the process, the session, and any queued prompts alive.
 * This is the same request the SDK's `interrupt()` sends on the CLI's stdin.
 */
export function interruptFrame(requestId: string = randomUUID(), reason = "user-cancel"): string {
  return JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "interrupt", reason },
  });
}

/**
 * Stop a live session's active turn over its messaging socket, without a
 * signal. Fire-and-forget: the frame is written and the socket is closed
 * without reading a response; the request id is returned for callers that
 * track it out of band. Throws when the session has no socket or the frame
 * cannot be written.
 */
export async function interrupt(s: LiveSession, reason?: string): Promise<string> {
  if (!s.messagingSocketPath) throw new Error(`Session ${s.pid} has no messaging socket.`);
  const token = await peerToken(s.pid);
  if (!token) throw new Error(`No peer token found for pid ${s.pid}.`);

  const requestId = randomUUID();
  const frame = interruptFrame(requestId, reason) + "\n";

  // Use a single connection: send auth first, drain queued bytes, then send the
  // interrupt frame on the same socket so the control_request is not stalled by
  // a full receive buffer. An absolute deadline caps the whole exchange — the
  // idle timeout alone would never fire against a peer that streams non-stop.
  await new Promise<void>((resolve, reject) => {
    const c = createConnection({ path: s.messagingSocketPath! });
    let sent = false;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      try { c.destroy(); } catch { /* already gone */ }
      resolve();
    };
    const deadline = setTimeout(settle, 900);
    c.setTimeout(700, () => {
      if (!sent) {
        sent = true;
        try { c.write(frame); } catch { /* socket may already be gone */ }
      }
      setTimeout(settle, 150);
    });
    c.on("error", (e) => {
      clearTimeout(deadline);
      c.destroy();
      reject(e);
    });
    c.on("data", () => {
      // discard queued bytes
    });
    c.on("connect", () => {
      c.write(JSON.stringify({ type: "auth", token }) + "\n");
    });
    c.on("close", () => {
      clearTimeout(deadline);
      settle();
    });
  });

  return requestId;
}

/**
 * Pause a resolved session by freezing its process (SIGSTOP). The session
 * stays alive and can be resumed with SIGCONT.
 */
export async function pauseSession(
  s: SessionInfo,
  deps: {
    /** Signal delivery; injectable so tests can stub. */
    kill?: (pid: number, signal: NodeJS.Signals) => void;
  } = {},
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  console.log("[pause] pauseSession: session=%s pid=%d online=%s", sessionLabel(s), s.pid, s.online);
  if (!s.online) {
    console.log("[pause] offline guard: session offline, nothing to pause");
    return {
      success: false,
      message: `Session ${sessionLabel(s)} is offline; nothing to pause. (Only active sessions can be paused.)`,
    };
  }
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    console.log("[pause] sending SIGSTOP to pid %d", s.pid);
    kill(s.pid, "SIGSTOP");
    console.log("[pause] SIGSTOP delivered to pid %d", s.pid);
    return {
      success: true,
      message: `Paused session ${sessionLabel(s)} (pid ${s.pid}) — process frozen; resume with SIGCONT.`,
      data: { sessionId: s.sessionId, pid: s.pid, name: sessionLabel(s), pause: "sigstop" },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log("[pause] SIGSTOP failed for pid %d: %s", s.pid, reason);
    return {
      success: false,
      message: `Could not pause session ${sessionLabel(s)} (pid ${s.pid}): ${reason}.`,
    };
  }
}

export async function resumeSession(
  s: SessionInfo,
  deps: {
    kill?: (pid: number, signal: NodeJS.Signals) => void;
  } = {},
): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  if (!s.online) {
    return {
      success: false,
      message: `Session ${sessionLabel(s)} is offline; nothing to resume. (Only active sessions can be resumed.)`,
    };
  }
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    kill(s.pid, "SIGCONT");
    return {
      success: true,
      message: `Resumed session ${sessionLabel(s)} (pid ${s.pid}).`,
      data: { sessionId: s.sessionId, pid: s.pid, name: sessionLabel(s), resume: "sigcont" },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Could not resume session ${sessionLabel(s)} (pid ${s.pid}): ${reason}.` };
  }
}

/**
 * Deliver one message to one live session. Throws on failure.
 *
 * `msgId` is caller-supplied when the body needs to carry its own id (the
 * auto-reply marker does); otherwise a fresh one is generated.
 */
export async function deliver(
  s: LiveSession,
  message: string,
  msgId: string = randomUUID(),
): Promise<string> {
  if (!s.messagingSocketPath) throw new Error(`Session ${s.pid} has no messaging socket.`);
  const token = await peerToken(s.pid);
  if (!token) throw new Error(`No peer token found for pid ${s.pid}.`);

  // Claude Code wraps a cross-session message in its own
  // <cross-session-message from-name=... from-mode=...> envelope on arrival,
  // taken from the sender's socket. Wrapping again here would nest a second,
  // hardcoded name inside the real one — receivers then attribute the message
  // to this CLI instead of to the session that actually sent it. Send plain
  // text, stripping any envelope the caller included.
  const body = message.replace(/<\/?cross-session-message[^>]*>/g, "").trim();
  const msg = { msgV: 1, msg_id: msgId, type: "user", message: { role: "user", content: body }, priority: "next" };
  const payload = JSON.stringify({ type: "auth", token }) + "\n" + JSON.stringify(msg) + "\n";
  await writeLine(s.messagingSocketPath, payload);
  return msgId;
}
