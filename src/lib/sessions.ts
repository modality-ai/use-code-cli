import { homedir } from "node:os";
import { join } from "node:path";
import { open, readdir, readFile, stat } from "node:fs/promises";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** One live Claude Code session, as written to ~/.claude/sessions/<pid>.json. */
export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  version?: string;
  kind?: string;
  entrypoint?: string;
  name?: string;
  nameSource?: string;
  status?: string;
  updatedAt?: number;
  messagingSocketPath?: string;
}

export interface SessionInfo extends SessionFile {
  online: boolean;
}

/** The parts of a session's transcript worth surfacing in `session <target>`. */
export interface TranscriptMeta {
  /** Last Counter hero deployed in the session, e.g. "WANDA". */
  hero?: string;
  /** Git branch the session's workspace was on. */
  branch?: string;
  /** Last prompt the user typed into the session. */
  lastPrompt?: string;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readSessionsLive(): Promise<SessionInfo[]> {
  let files: string[];
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const data = JSON.parse(
        await readFile(join(SESSIONS_DIR, file), "utf8"),
      ) as SessionFile;
      sessions.push({ ...data, online: isAlive(data.pid) });
    } catch {
      // Skip unreadable or malformed session files.
    }
  }
  return sessions;
}

/**
 * Claude Code removes ~/.claude/sessions/<pid>.json when a session exits, but
 * keeps the transcript at ~/.claude/projects/<project>/<sessionId>.jsonl.
 * Offline sessions are recovered from those transcripts.
 */
async function readOfflineSessions(known: Set<string>): Promise<SessionInfo[]> {
  const out: SessionInfo[] = [];
  let projects: string[];
  try {
    projects = await readdir(PROJECTS_DIR);
  } catch {
    return out;
  }

  for (const project of projects) {
    let files: string[];
    try {
      files = await readdir(join(PROJECTS_DIR, project));
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
      const sessionId = file.slice(0, -".jsonl".length);
      if (known.has(sessionId)) continue;
      const path = join(PROJECTS_DIR, project, file);
      try {
        const st = await stat(path);
        const fh = await open(path, "r");
        const buf = Buffer.alloc(65536);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        const head = buf.toString("utf8", 0, bytesRead);
        const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
        out.push({
          pid: 0,
          sessionId,
          cwd: cwd ? JSON.parse(`"${cwd}"`) : project,
          startedAt: st.birthtimeMs,
          updatedAt: st.mtimeMs,
          status: "offline",
          online: false,
        });
      } catch {
        // Skip unreadable transcripts.
      }
    }
  }
  return out;
}

/** All known sessions, newest activity first. */
export async function readSessions(includeOffline: boolean): Promise<SessionInfo[]> {
  const sessions = await readSessionsLive();
  if (includeOffline) {
    const known = new Set(sessions.map((s) => s.sessionId));
    sessions.push(...(await readOfflineSessions(known)));
  }
  return sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** How Claude Code names a project directory: every non-alphanumeric → "-". */
function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate a session's transcript. The direct path is tried first; the directory
 * scan is the fallback so a changed encoding never hides the transcript.
 */
async function transcriptPath(s: SessionInfo): Promise<string | undefined> {
  const direct = join(PROJECTS_DIR, projectDirName(s.cwd), `${s.sessionId}.jsonl`);
  if (await exists(direct)) return direct;

  let projects: string[];
  try {
    projects = await readdir(PROJECTS_DIR);
  } catch {
    return undefined;
  }
  for (const project of projects) {
    const candidate = join(PROJECTS_DIR, project, `${s.sessionId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function readChunk(path: string, start: number, length: number): Promise<string> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.toString("utf8", 0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * How much of the transcript to scan. The hero is deployed at the start of a
 * session and git branch / last prompt are written throughout, so the head and
 * the tail together cover both ends without reading a multi-megabyte transcript
 * in full.
 */
const SCAN_BYTES = 1024 * 1024;

function lastMatch(re: RegExp, text: string): string | undefined {
  let found: string | undefined;
  for (const m of text.matchAll(re)) found = m[1];
  return found;
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}

/**
 * Read the small facts a transcript holds about its session: the deployed
 * hero, the workspace's git branch, and the last prompt.
 */
export async function readTranscriptMeta(s: SessionInfo): Promise<TranscriptMeta> {
  const path = await transcriptPath(s);
  if (!path) return {};

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return {};
  }

  const head = await readChunk(path, 0, Math.min(SCAN_BYTES, size));
  const tailStart = Math.max(0, size - SCAN_BYTES);
  const tail = tailStart > 0 ? await readChunk(path, tailStart, SCAN_BYTES) : "";
  const text = `${head}\n${tail}`;

  const hero = lastMatch(
    /"name"\s*:\s*"mcp__Counter___Counter__Deploy"\s*,\s*"input"\s*:\s*\{\s*"callSign"\s*:\s*"([A-Za-z0-9_-]+)"/g,
    text,
  );
  const branch = lastMatch(/"gitBranch"\s*:\s*"((?:[^"\\]|\\.)*)"/g, text);
  const lastPrompt = lastMatch(
    /"type"\s*:\s*"last-prompt"\s*,\s*"lastPrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    text,
  );

  return {
    hero,
    branch: branch ? unescapeJsonString(branch) : undefined,
    lastPrompt: lastPrompt ? unescapeJsonString(lastPrompt) : undefined,
  };
}
