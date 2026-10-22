import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { open, readdir, readFile, stat } from "node:fs/promises";
import type { CLICommand } from "modality-cli-kit";

const SessionsArgsSchema = z.object({
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also list offline sessions (process no longer running)"),
});

type SessionsArgs = z.infer<typeof SessionsArgsSchema>;

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  version?: string;
  kind?: string;
  name?: string;
  status?: string;
  updatedAt?: number;
}

export interface SessionInfo extends SessionFile {
  online: boolean;
}

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readSessions(includeOffline: boolean): Promise<SessionInfo[]> {
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
  if (includeOffline) {
    const known = new Set(sessions.map((s) => s.sessionId));
    sessions.push(...(await readOfflineSessions(known)));
  }
  return sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
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

async function sessions(args: SessionsArgs) {
  const all = await readSessions(args.all);
  const list = args.all ? all : all.filter((s) => s.online);

  const rows = list.map((s) => ({
    state: s.online ? "active" : "offline",
    pid: s.pid,
    name: s.name ?? "",
    status: s.status ?? "",
    cwd: s.cwd,
    sessionId: s.sessionId,
    version: s.version ?? "",
    updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "",
  }));

  const message = rows.length
    ? rows
        .map(
          (r) =>
            `[${r.state}] ${r.name || r.sessionId}  pid=${r.pid}  ${r.status}  ${r.cwd}`,
        )
        .join("\n")
    : args.all
      ? "No sessions found."
      : "No active sessions. Use --all to include offline sessions.";

  return { success: true, message, data: rows };
}

export const sessionsCommand: CLICommand = {
  name: "sessions",
  aliases: ["ls"],
  description: "List Claude Code CLI sessions (active by default)",
  inputSchema: SessionsArgsSchema,
  positionalKeys: [],
  execute: sessions,
  examples: ["use-code-cli sessions", "use-code-cli sessions --all"],
};
