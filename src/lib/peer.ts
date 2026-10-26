import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { readSessionsLive, SESSIONS_DIR } from "./sessions";

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
