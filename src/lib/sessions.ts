import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { appendFile, mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";

export const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
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
  /**
   * Folder the session ended in, when a transcript shows it `cd`'d away from
   * where it launched. Offline sessions only; `--filter-folder` matches both.
   */
  latestCwd?: string;
}

/** What `--filter-name` / `--filter-status` / `--filter-hero` / `--filter-folder` narrow a session list to. */
export interface SessionFilter {
  filterName?: string;
  filterStatus?: string;
  filterHero?: string;
  filterFolder?: string;
}

/** The values `--filter-status` accepts. */
export const SESSION_STATUSES = ["busy", "idle"] as const;

/** ~/.claude/sessions/names.json — the names the user set, keyed by sessionId. */
export const NAMES_FILE = join(SESSIONS_DIR, "names.json");

/** A user-set session name, keyed by the session it belongs to. */
export type SessionNameRegistry = Record<string, string>;

/**
 * The names the user set on sessions, from ~/.claude/sessions/names.json —
 * Claude Code deletes its pid file (which carries the derived name) on exit,
 * so the registry is the only durable store of a custom name.
 */
export async function readSessionNames(): Promise<SessionNameRegistry> {
  try {
    const parsed = JSON.parse(await readFile(NAMES_FILE, "utf8")) as Record<string, unknown>;
    const names: SessionNameRegistry = {};
    for (const [sessionId, name] of Object.entries(parsed)) {
      if (typeof name === "string") names[sessionId] = name;
    }
    return names;
  } catch {
    // Missing or unreadable registry — fall back to the derived names.
    return {};
  }
}

/**
 * Pin a session's name: one entry in the registry, keyed by sessionId, so it
 * survives Claude Code's pid-file lifecycle and wins over the derived name.
 */
export async function setSessionName(sessionId: string, name: string): Promise<void> {
  const names = await readSessionNames();
  names[sessionId] = name;
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(NAMES_FILE, `${JSON.stringify(names, null, 2)}\n`, "utf8");
}

/**
 * Append a custom title to a session's transcript so Claude Code's
 * `--resume <name>` resolves the session by its user-set name. Claude Code
 * itself writes these lines when a session is named with `-n`; mirroring
 * them keeps CLI renames visible to Claude Code.
 */
export async function appendSessionTitle(s: SessionInfo, name: string): Promise<void> {
  const path = await transcriptPath(s);
  if (!path) return;
  const lines = [
    JSON.stringify({ type: "custom-title", customTitle: name, sessionId: s.sessionId }),
    JSON.stringify({ type: "agent-name", agentName: name, sessionId: s.sessionId }),
  ].join("\n") + "\n";
  try {
    await appendFile(path, lines, "utf8");
  } catch {
    // Best-effort: the registry is the primary store; a transcript write
    // failure shouldn't fail the rename (e.g. read-only or missing file).
  }
}

/**
 * The project directory where Claude Code can find this session's transcript
 * by running `claude --resume <name>` from it. Derived from the transcript's
 * own location (not s.cwd, which may differ after the session cd'd elsewhere).
 */
export async function transcriptProjectCwd(s: SessionInfo): Promise<string | undefined> {
  const path = await transcriptPath(s);
  if (!path) return s.cwd;
  const projectDir = basename(dirname(path));
  // Scan the transcript for a cwd whose encoding matches the project dir.
  let text: string;
  try {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fh.read(buf, 0, 65536, 0);
      text = buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch {
    return s.cwd;
  }
  const re = /"cwd":"((?:[^"\\]|\\.)*)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    if (raw === undefined) continue;
    const cwd = unescapeJsonString(raw);
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    if (encodeProjectDir(cwd) === projectDir) return cwd;
  }
  return s.cwd;
}
/**
 * Move a session's transcript into the project directory for `newCwd` so
 * Claude Code discovers it when run from that directory. Returns the new
 * transcript path, or undefined if there was no transcript to move.
 */
export async function moveTranscript(s: SessionInfo, newCwd: string): Promise<string | undefined> {
  const src = await transcriptPath(s);
  if (!src) return undefined;
  const destDir = join(PROJECTS_DIR, encodeProjectDir(newCwd));
  const dest = join(destDir, `${s.sessionId}.jsonl`);
  if (src === dest) return dest;
  await mkdir(destDir, { recursive: true });
  try {
    await rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
    const { copyFile, unlink } = await import("node:fs/promises");
    await copyFile(src, dest);
    await unlink(src);
  }
  return dest;
}

export function applySessionNames<T extends { sessionId: string; name?: string; nameSource?: string }>(
  sessions: T[],
  names: SessionNameRegistry,
): T[] {
  for (const s of sessions) {
    const custom = names[s.sessionId];
    if (custom !== undefined) {
      s.name = custom;
      s.nameSource = "user";
    }
  }
  return sessions;
}

/** Split a comma-separated flag value into trimmed, lowercase terms. */
export function splitFilterTerms(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term !== "");
}

/**
 * True when a session passes the name/status/hero/folder filters; an absent or
 * empty filter passes. Each filter takes a comma-separated list and matches any
 * of its terms. Hero lives in the transcript, so callers supply it once read.
 */
export function matchesSessionFilter(
  s: {
    name?: string;
    status?: string;
    hero?: string | null;
    cwd?: string;
    latestCwd?: string;
  },
  filter: SessionFilter,
): boolean {
  const nameTerms = splitFilterTerms(filter.filterName);
  if (nameTerms.length > 0) {
    // Claude Code deletes the pid file that carried an offline session's name,
    // so fall back to its workspace folder — the label the name was derived from.
    const name = (s.name ?? basename(s.cwd ?? "")).toLowerCase();
    if (!nameTerms.some((term) => name.includes(term))) return false;
  }

  const statusTerms = splitFilterTerms(filter.filterStatus);
  if (statusTerms.length > 0 && !statusTerms.includes((s.status ?? "").toLowerCase())) {
    return false;
  }

  const heroTerms = splitFilterTerms(filter.filterHero);
  if (heroTerms.length > 0) {
    const hero = (s.hero ?? "").toLowerCase();
    if (!heroTerms.some((term) => hero.includes(term))) return false;
  }

  const folderTerms = splitFilterTerms(filter.filterFolder);
  if (folderTerms.length > 0) {
    // A keyword names the workspace folder itself, so only its basename is
    // matched — a parent directory in the path never counts. A session that
    // moved during its life counts under both the launch and the final folder.
    const folders = [s.cwd, s.latestCwd]
      .filter((path): path is string => path !== undefined)
      .map((path) => basename(path).toLowerCase());
    if (!folderTerms.some((term) => folders.some((folder) => folder.includes(term)))) {
      return false;
    }
  }
  return true;
}

/** The active filters spelled out for an empty result, e.g. ` matching --filter-status=busy`. */
export function describeSessionFilter(filter: SessionFilter): string {
  const parts: string[] = [];
  if (filter.filterName !== undefined) parts.push(`--filter-name=${filter.filterName}`);
  if (filter.filterStatus !== undefined) parts.push(`--filter-status=${filter.filterStatus}`);
  if (filter.filterHero !== undefined) parts.push(`--filter-hero=${filter.filterHero}`);
  if (filter.filterFolder !== undefined) parts.push(`--filter-folder=${filter.filterFolder}`);
  return parts.length > 0 ? ` matching ${parts.join(" ")}` : "";
}

/** The parts of a session's transcript worth surfacing in `session <target>`. */
export interface TranscriptMeta {
  /** Last Counter hero deployed in the session, e.g. "WANDA". */
  hero?: string;
  /** Git branch the session's workspace was on. */
  branch?: string;
  /** Last prompt the session received: typed by the user, or sent by another session. */
  lastPrompt?: string;
}

/** The name a session goes by in output: its registered name, else its sessionId. */
export function sessionLabel(s: { name?: string; sessionId: string }): string {
  return s.name ?? s.sessionId;
}

/**
 * Sessions a target names. Exact name / sessionId / pid wins; otherwise a name
 * prefix, so `session use-design` finds `use-design-05`.
 */
export function findSessions(sessions: SessionInfo[], target: string): SessionInfo[] {
  const exact = sessions.filter(
    (s) =>
      s.name === target ||
      s.sessionId === target ||
      (s.pid !== 0 && String(s.pid) === target),
  );
  if (exact.length > 0) return exact;
  return sessions.filter((s) => s.name?.startsWith(target));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How much of a transcript's head and tail to read when only a cwd is needed. */
const CWD_SCAN_BYTES = 65536;

const CWD_PATTERN = /"cwd":"((?:[^"\\]|\\.)*)"/g;

/** The workspace path recorded last in `text`, unescaped. */
function lastCwdIn(text: string): string | undefined {
  const cwd = lastMatch(CWD_PATTERN, text);
  return cwd === undefined ? undefined : unescapeJsonString(cwd);
}

/**
 * The workspace paths a transcript records: the last cwd in its first 64 KiB,
 * and the last cwd in its last 64 KiB. A session that `cd`s elsewhere keeps
 * writing the new path, so the tail is what `--filter-folder` needs to still
 * find the folder a session moved to.
 */
export async function readTranscriptCwds(
  path: string,
): Promise<{ start?: string; end?: string }> {
  try {
    const { size } = await stat(path);
    const start = lastCwdIn(await readChunk(path, 0, Math.min(CWD_SCAN_BYTES, size)));
    if (size <= CWD_SCAN_BYTES) return { start, end: start };
    const tail = await readChunk(path, size - CWD_SCAN_BYTES, CWD_SCAN_BYTES);
    return { start, end: lastCwdIn(tail) };
  } catch {
    return {};
  }
}

/**
 * The workspace path recorded near the top of a transcript. Returns undefined
 * when the file is unreadable or records no cwd.
 */
export async function readTranscriptCwd(path: string): Promise<string | undefined> {
  return (await readTranscriptCwds(path)).start;
}

/** Every session file, live or stale — `online` tells them apart. */
export async function readSessionsLive(): Promise<SessionInfo[]> {
  let files: string[];
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];
  for (const file of files.filter((f) => f.endsWith(".json") && f !== basename(NAMES_FILE))) {
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
        const { start, end } = await readTranscriptCwds(path);
        out.push({
          pid: 0,
          sessionId,
          cwd: start ?? project,
          latestCwd: end,
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
  applySessionNames(sessions, await readSessionNames());
  return sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Claude Code's directory name for a workspace path: every non-alphanumeric → "-". */
export function encodeProjectDir(cwd: string): string {
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
export async function transcriptPath(s: SessionInfo): Promise<string | undefined> {
  const direct = join(PROJECTS_DIR, encodeProjectDir(s.cwd), `${s.sessionId}.jsonl`);
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
 * How much of the transcript to scan for git branch / last prompt. Both are
 * written throughout a session, so the head and the tail together cover them
 * without reading a multi-megabyte transcript in full.
 */
const SCAN_BYTES = 1024 * 1024;

/**
 * Longest span a Deploy match can cover. Consecutive hero chunks overlap by this
 * much so a call straddling a chunk boundary is still seen whole.
 */
const HERO_OVERLAP_BYTES = 512;

const DEPLOY_PATTERN =
  /"name"\s*:\s*"mcp__Counter___Counter__Deploy"\s*,\s*"input"\s*:\s*\{\s*"callSign"\s*:\s*"([A-Za-z0-9_-]+)"/g;

function lastMatch(re: RegExp, text: string): string | undefined {
  return lastMatchAt(re, text)?.value;
}

/** The last match of `re` in `text`: where it starts, plus its first capture. */
function lastMatchAt(re: RegExp, text: string): { at: number; value: string } | undefined {
  let found: { at: number; value: string } | undefined;
  for (const m of text.matchAll(re)) found = { at: m.index, value: m[1] ?? "" };
  return found;
}

/** What the user typed, as Claude Code records it. */
const LAST_PROMPT_PATTERN =
  /"type"\s*:\s*"last-prompt"\s*,\s*"lastPrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * A message another Claude session delivered into this one. It arrives as a
 * plain user message, so it counts as a prompt too. The capture starts after
 * the boilerplate prefix, which is never shown.
 */
const PEER_PROMPT_PATTERN =
  /"type"\s*:\s*"user"[^\n]*?"content"\s*:\s*"Another Claude session sent a message:\\n((?:[^"\\]|\\.)*)"/g;

/** Claude Code's wrapper around a delivered peer message; its markup is not text. */
const PEER_ENVELOPE_PATTERN = /<\/?cross-session-message[^>]*>/g;

/** The entry a prompt the human typed or sent was recorded as. */
const HUMAN_PROMPT_PATTERN = /"type"\s*:\s*"user"[^\n]*?"turnOrigin"\s*:\s*"human"/g;

/**
 * The newest prompt in `text`: the typed one, or a message another session sent
 * in. Claude Code rewrites the `last-prompt` record every turn while keeping the
 * old value, so the record's own position cannot tell whether a peer message
 * came after the last typed prompt — the typed prompt's entry can. Transcripts
 * old enough to lack that marker fall back to the record's position.
 */
function lastPromptIn(text: string): string | undefined {
  const typed = lastMatchAt(LAST_PROMPT_PATTERN, text);
  const peer = lastMatchAt(PEER_PROMPT_PATTERN, text);
  if (!peer) return typed ? unescapeJsonString(typed.value) : undefined;

  const typedAt = lastMatchAt(HUMAN_PROMPT_PATTERN, text)?.at ?? typed?.at ?? -1;
  if (peer.at > typedAt) {
    return unescapeJsonString(peer.value).replace(PEER_ENVELOPE_PATTERN, "").trim();
  }
  return typed ? unescapeJsonString(typed.value) : undefined;
}

/**
 * The hero can be redeployed at any point in a session, so the latest Deploy
 * may sit far from both ends. Scan backwards from the end of the file and stop
 * at the first chunk that holds one: that is the newest.
 */
async function findHero(path: string, size: number): Promise<string | undefined> {
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - SCAN_BYTES);
    const chunk = await readChunk(path, start, end - start + HERO_OVERLAP_BYTES);
    const hero = lastMatch(DEPLOY_PATTERN, chunk);
    if (hero) return hero;
    end = start;
  }
  return undefined;
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

  const hero = await findHero(path, size);
  const branch = lastMatch(/"gitBranch"\s*:\s*"((?:[^"\\]|\\.)*)"/g, text);
  const lastPrompt = lastPromptIn(text);

  return {
    hero,
    branch: branch ? unescapeJsonString(branch) : undefined,
    lastPrompt,
  };
}

/** A prompt a session received, as its transcript records it. */
export interface SessionPrompt {
  /** Who sent it: the human at the keyboard, or another Claude session. */
  kind: "typed" | "peer";
  /** 1-based transcript line number. */
  line: number;
  /** When the prompt arrived, in epoch milliseconds. */
  timestamp?: number;
  /** Prompt text, with the cross-session envelope removed. */
  text: string;
}

/** The prefix Claude Code puts on a message another session delivered. */
const PEER_PREFIX = "Another Claude session sent a message:\n";

interface TranscriptUserEntry {
  type?: string;
  isSidechain?: boolean;
  toolUseResult?: unknown;
  timestamp?: string;
  origin?: { kind?: string };
  turnOrigin?: string;
  message?: { content?: unknown };
}

/** The text blocks of a message's content; images and tool noise are dropped. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join(" ");
}

/**
 * The prompt one transcript line records, or undefined for everything else.
 * Tool results and system-injected entries also have `type: "user"`, so the
 * human/peer origin marker is what separates a real prompt from them.
 */
function promptFromLine(raw: string, line: number): SessionPrompt | undefined {
  let entry: TranscriptUserEntry;
  try {
    entry = JSON.parse(raw) as TranscriptUserEntry;
  } catch {
    return undefined;
  }
  if (entry.type !== "user" || entry.isSidechain || entry.toolUseResult !== undefined) {
    return undefined;
  }

  const kind = entry.origin?.kind ?? entry.turnOrigin;
  if (kind !== "human" && kind !== "peer") return undefined;

  const text = contentText(entry.message?.content);
  if (!text) return undefined;
  const cleaned = (
    kind === "peer"
      ? text.replace(PEER_PREFIX, "").replace(PEER_ENVELOPE_PATTERN, "")
      : text
  ).trim();
  if (!cleaned) return undefined;

  const timestamp = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
  return {
    kind: kind === "peer" ? "peer" : "typed",
    line,
    timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
    text: cleaned,
  };
}

/** One cron job a session scheduled, recovered from its transcript. */
export interface SessionCron {
  /** Job id Claude Code assigned, as CronCreate's result reported it. */
  id: string;
  /** Cron expression the job was created with, e.g. "2-59/5 * * * *". */
  cron: string;
  /** Human schedule from the result, e.g. "Every 5 minutes". */
  schedule?: string;
  recurring: boolean;
  /** The prompt the job runs each tick. */
  prompt: string;
  /** When the job was created, in epoch milliseconds. */
  createdAt?: number;
  /** 1-based transcript line of the CronCreate call. */
  line: number;
}

interface CronToolBlock {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  content?: unknown;
  input?: { cron?: unknown; prompt?: unknown; recurring?: unknown };
}

/** The scheduled job a CronCreate result describes, with its human schedule. */
const SCHEDULED_PATTERN =
  /Scheduled\s+(?:recurring\s+|one-shot\s+|one-time\s+|single\s+)?job\s+([A-Za-z0-9_-]+)(?:\s*\(([^)]*)\))?/;

/** The job a CronDelete result confirms it cancelled. */
const CANCELLED_PATTERN = /Cancelled\s+job\s+([A-Za-z0-9_-]+)/;

/**
 * Cron jobs a session's transcript still has scheduled: every CronCreate whose
 * result assigned an id, minus every job a CronDelete confirmed it cancelled.
 * Claude Code keeps cron jobs in memory only, so the transcript is the only
 * durable record — after the session exits, the list is what it last held.
 */
export async function readCronJobs(s: SessionInfo): Promise<SessionCron[]> {
  const path = await transcriptPath(s);
  if (!path) return [];

  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });

  /** CronCreate calls waiting for the result that carries the job id. */
  const pending = new Map<
    string,
    { cron: string; prompt: string; recurring: boolean; createdAt?: number; line: number }
  >();
  const active = new Map<string, SessionCron>();
  let lineNo = 0;

  for await (const raw of lines) {
    lineNo++;
    let entry: { timestamp?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(raw) as typeof entry;
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const at = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;

    for (const block of content as CronToolBlock[]) {
      if (!block || typeof block !== "object") continue;

      if (block.type === "tool_use" && block.name === "CronCreate") {
        const input = block.input ?? {};
        if (typeof block.id !== "string") continue;
        if (typeof input.cron !== "string" || typeof input.prompt !== "string") continue;
        pending.set(block.id, {
          cron: input.cron,
          prompt: input.prompt,
          recurring: input.recurring !== false,
          createdAt: Number.isNaN(at) ? undefined : at,
          line: lineNo,
        });
        continue;
      }

      if (block.type !== "tool_result") continue;
      const text = contentText(block.content);

      const cancelled = CANCELLED_PATTERN.exec(text)?.[1];
      if (cancelled) {
        active.delete(cancelled);
        continue;
      }

      const scheduled = SCHEDULED_PATTERN.exec(text);
      const jobId = scheduled?.[1];
      const created = block.tool_use_id ? pending.get(block.tool_use_id) : undefined;
      if (!jobId || !created || !block.tool_use_id) continue;
      active.set(jobId, {
        id: jobId,
        cron: created.cron,
        schedule: scheduled[2] || undefined,
        recurring: created.recurring,
        prompt: created.prompt,
        createdAt: created.createdAt,
        line: created.line,
      });
      pending.delete(block.tool_use_id);
    }
  }

  return [...active.values()];
}

/** Every prompt a session's transcript records, oldest first. */
export async function readPrompts(s: SessionInfo): Promise<SessionPrompt[]> {
  const path = await transcriptPath(s);
  if (!path) return [];

  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });

  const prompts: SessionPrompt[] = [];
  let lineNo = 0;
  for await (const raw of lines) {
    lineNo++;
    const prompt = promptFromLine(raw, lineNo);
    if (prompt) prompts.push(prompt);
  }
  return prompts;
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
