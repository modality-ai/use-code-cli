import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { formatTime, oneLine, plural } from "../../lib/format";
import {
  appendSessionTitle,
  findSessions,
  moveTranscript,
  NAMES_FILE,
  readCronJobs,
  readSessions,
  readTranscriptMeta,
  sessionLabel as label,
  setSessionName,
  transcriptPath,
  transcriptProjectCwd,
  type SessionCron,
  type SessionInfo,
} from "../../lib/sessions";

const SessionArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe("Session name, pid, or sessionId (a unique name prefix also works)"),
  rename: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Rename the target session to this name — pinned durably, wins over the derived name",
    ),
  cwd: z
    .string()
    .min(1)
    .optional()
    .describe("Move the session's transcript into the project directory for this cwd"),
});

type SessionArgs = z.infer<typeof SessionArgsSchema>;

function ago(ms?: number): string {
  if (!ms) return "";
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function row(label: string, value: string | undefined): string {
  return `  ${label.padEnd(11)} ${value && value.trim() !== "" ? value : "—"}`;
}

/**
 * The cron block: a summary row, then one entry per job. A job's human
 * schedule is only shown when it adds something the expression does not.
 */
function cronLines(crons: SessionCron[], online: boolean): string[] {
  if (crons.length === 0) return [row("cron", "none")];

  const note = online ? "session-only" : "last known · session-only jobs ended";
  const lines = [row("cron", `${plural(crons.length, "job")} · ${note}`)];
  for (const c of crons) {
    const schedule =
      c.schedule && c.schedule !== c.cron
        ? `cron="${c.cron}"  schedule="${c.schedule}"`
        : `cron="${c.cron}"`;
    lines.push(`    ${c.id}  ${schedule}`);
    lines.push(`      "${oneLine(c.prompt, 100)}"`);
  }
  return lines;
}

function howToTalk(name: string): string {
  return ["💡 Talk to this session:", `  use-code-cli talk ${name} "your message"`].join("\n");
}

/** Rename one resolved session, refusing a name another session already holds. */
async function performSessionUpdate(s: SessionInfo, newName: string | undefined, newCwd: string | undefined) {
  const lines: string[] = [];

  if (newName !== undefined) {
    const taken = (await readSessions(true)).find(
      (o) => o.sessionId !== s.sessionId && (o.name ?? "") === newName,
    );
    if (taken) {
      return {
        success: false,
        message: `"${newName}" is already taken by session ${taken.sessionId}. Pick another name.`,
      };
    }
    const from = label(s);
    await setSessionName(s.sessionId, newName);
    await appendSessionTitle(s, newName);
    const renamed =
      from === newName
        ? `Session is already named "${newName}" — pinned as its permanent name.`
        : `Renamed session "${from}" → "${newName}"`;
    lines.push(renamed);
    lines.push(`Pinned via ${NAMES_FILE}; it survives session exit and wins over the derived name.`);
  }

  if (newCwd !== undefined) {
    const moved = await moveTranscript(s, newCwd);
    if (moved) {
      lines.push(`Moved transcript → ${moved}`);
    } else {
      lines.push(`No transcript found for this session; nothing to move.`);
    }
  }

  const resumeDir = newCwd !== undefined ? newCwd : await transcriptProjectCwd(s);
  const resumeName = newName ?? label(s);
  lines.push(`Resume in Claude Code: cd ${resumeDir} && claude --resume ${resumeName}`);
  lines.push(
    ` (Claude Code searches the current project by default; from another directory, run the cd above, or press Ctrl+A in the picker to search all projects.)`,
  );

  return {
    success: true,
    message: lines.join("\n"),
    data: { sessionId: s.sessionId, from: label(s), to: newName, cwd: newCwd },
  };
}

async function session(args: SessionArgs) {
  const live = await readSessions(false);
  let matches = findSessions(live, args.target);
  if (matches.length === 0) {
    // Nothing live matched — include offline sessions recovered from transcripts.
    matches = findSessions(await readSessions(true), args.target);
  }

  if (matches.length === 0) {
    return {
      success: false,
      message: `No session matches "${args.target}". Try: use-code-cli sessions --all`,
    };
  }

  if (matches.length > 1) {
    const rows = matches
      .map((s) => `  ${label(s)}  pid=${s.pid}  ${s.cwd}`)
      .join("\n");
    return {
      success: false,
      message: `"${args.target}" is ambiguous; use a full name or pid:\n${rows}`,
    };
  }

  const s = matches[0];
  if (!s) {
    return { success: false, message: `No session matches "${args.target}".` };
  }
  if (args.rename !== undefined || args.cwd !== undefined) {
    return performSessionUpdate(s, args.rename, args.cwd);
  }
  const meta = await readTranscriptMeta(s);
  const rawFile = await transcriptPath(s);
  const crons = await readCronJobs(s);
  const name = label(s);

  const state = s.online ? `${s.status ?? "unknown"} · active` : "offline";
  const lines = [
    name,
    row("state", state),
    ...(s.nameSource === "user" ? [row("name source", "user (--rename)")] : []),
    row("workspace", s.cwd),
    row("branch", meta.branch),
    row("hero", meta.hero),
    row("last prompt", meta.lastPrompt ? `"${oneLine(meta.lastPrompt, 100)}"` : undefined),
    row("pid", String(s.pid)),
    row("sessionId", s.sessionId),
    row("transcript", rawFile),
    row("version", s.version),
    row("started", s.startedAt ? `${formatTime(s.startedAt)} (${ago(s.startedAt)})` : undefined),
    row("updated", s.updatedAt ? `${formatTime(s.updatedAt)} (${ago(s.updatedAt)})` : undefined),
    ...cronLines(crons, s.online),
    "",
    s.online
      ? howToTalk(name)
      : `This session is offline — start it in ${s.cwd} before talking to it.`,
  ];

  return {
    success: true,
    message: lines.join("\n"),
    data: {
      name: s.name ?? null,
      online: s.online,
      status: s.status ?? null,
      pid: s.pid,
      sessionId: s.sessionId,
      transcriptPath: rawFile ?? null,
      cwd: s.cwd,
      branch: meta.branch ?? null,
      hero: meta.hero ?? null,
      lastPrompt: meta.lastPrompt ?? null,
      version: s.version ?? null,
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
      updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
      // A command an agent can run verbatim; offline sessions cannot be talked
      // to until they start again, so the text output withholds it too.
      talk: s.online
        ? { target: name, command: `use-code-cli talk ${name} "your message"` }
        : null,
      crons: crons.map((c) => ({
        id: c.id,
        cron: c.cron,
        schedule: c.schedule ?? null,
        recurring: c.recurring,
        prompt: c.prompt,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      })),
    },
  };
}

export const sessionCommand: CLICommand = {
  name: "session",
  description: "Show one session's workspace, hero, cron jobs, and how to talk to it",
  inputSchema: SessionArgsSchema,
  positionalKeys: ["target"],
  execute: session,
  examples: [
    "use-code-cli session 49606 --json",
    "use-code-cli session use-design-05 --rename fix-auth",
    "use-code-cli session po-use-island --cwd /Volumes/GoldenSnake/git/use-island",
  ],
};
