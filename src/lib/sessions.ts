import { homedir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { open, readdir, readFile, stat } from "node:fs/promises";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
export const PROJECTS_DIR = join(homedir(), ".claude", "projects");

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

/** What `--filter-name` / `--filter-status` narrow a session list to. */
export interface SessionFilter {
  filterName?: string;
  filterStatus?: string;
}

/** The values `--filter-status` accepts. */
export const SESSION_STATUSES = ["busy", "idle"] as const;

/** Split a comma-separated flag value into trimmed, lowercase terms. */
export function splitFilterTerms(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term !== "");
}

/**
 * True when a session passes the name/status filters; an absent or empty filter
 * passes. Both filters take a comma-separated list and match any of its terms.
 */
export function matchesSessionFilter(
  s: { name?: string; status?: string },
  filter: SessionFilter,
): boolean {
  const nameTerms = splitFilterTerms(filter.filterName);
  if (nameTerms.length > 0) {
    const name = (s.name ?? "").toLowerCase();
    if (!nameTerms.some((term) => name.includes(term))) return false;
  }

  const statusTerms = splitFilterTerms(filter.filterStatus);
  if (statusTerms.length > 0 && !statusTerms.includes((s.status ?? "").toLowerCase())) {
    return false;
  }
  return true;
}

/** The active filters spelled out for an empty result, e.g. ` matching --filter-status=busy`. */
export function describeSessionFilter(filter: SessionFilter): string {
  const parts: string[] = [];
  if (filter.filterName !== undefined) parts.push(`--filter-name=${filter.filterName}`);
  if (filter.filterStatus !== undefined) parts.push(`--filter-status=${filter.filterStatus}`);
  return parts.length > 0 ? ` matching ${parts.join(" ")}` : "";
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

/** How much of a transcript's head to read when only its cwd is needed. */
const CWD_SCAN_BYTES = 65536;

/**
 * The workspace path recorded near the top of a transcript. Returns undefined
 * when the file is unreadable or records no cwd.
 */
export async function readTranscriptCwd(path: string): Promise<string | undefined> {
  try {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(CWD_SCAN_BYTES);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.toString("utf8", 0, bytesRead);
      const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
      return cwd ? unescapeJsonString(cwd) : undefined;
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
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
        const cwd = await readTranscriptCwd(path);
        out.push({
          pid: 0,
          sessionId,
          cwd: cwd ?? project,
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

/** Where a search term occurred in a transcript. */
export interface TranscriptMatch {
  /** Total occurrences across the whole transcript. */
  matches: number;
  /** 1-based line number of the first occurrence. */
  line: number;
  /** Readable context around the first occurrence, on one line. */
  snippet: string;
}

const NO_MATCH: TranscriptMatch = { matches: 0, line: 0, snippet: "" };

/** Non-overlapping occurrences of `needle` in `haystack`; both already lowercase. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    count++;
  }
  return count;
}

/**
 * The human-readable text of a transcript line. A hit can sit in any JSON field
 * (tool input, prompt, reply), so unreadable lines fall back to their raw form.
 */
function readableLine(raw: string): string {
  try {
    const entry = JSON.parse(raw) as { message?: { content?: unknown }; lastPrompt?: unknown };
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const texts = content
        .map((block) =>
          block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
            ? (block as { text: string }).text
            : "",
        )
        .filter(Boolean);
      if (texts.length > 0) return texts.join(" ");
    }
    if (typeof entry.lastPrompt === "string") return entry.lastPrompt;
  } catch {
    // Not JSON — the raw line is all there is.
  }
  return raw;
}

/** A one-line window of `text` around `index`, padded with ellipses. */
function snippetAround(text: string, index: number, width = 100): string {
  const start = Math.max(0, index - Math.floor(width / 2));
  const end = Math.min(text.length, start + width);
  const body = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * Search one session's whole transcript for `term` (case-insensitive), streaming
 * the file so a multi-megabyte transcript never lands in memory at once.
 */
export async function searchTranscript(s: SessionInfo, term: string): Promise<TranscriptMatch> {
  const path = await transcriptPath(s);
  if (!path) return NO_MATCH;

  const needle = term.toLowerCase();
  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });

  let matches = 0;
  let first: { line: number; snippet: string } | undefined;
  let lineNo = 0;

  for await (const raw of lines) {
    lineNo++;
    const hits = countOccurrences(raw.toLowerCase(), needle);
    if (hits === 0) continue;
    matches += hits;
    if (first) continue;

    const readable = readableLine(raw).replace(/\s+/g, " ").trim();
    const at = readable.toLowerCase().indexOf(needle);
    const text = at >= 0 ? readable : raw.replace(/\s+/g, " ").trim();
    const index = at >= 0 ? at : text.toLowerCase().indexOf(needle);
    first = { line: lineNo, snippet: snippetAround(text, Math.max(0, index)) };
  }

  return first ? { matches, line: first.line, snippet: first.snippet } : NO_MATCH;
}
