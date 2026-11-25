import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { formatTime, oneLine, plural } from "../../lib/output/format";
import {
  appendSessionTitle,
  findSessions,
  moveTranscript,
  NAMES_FILE,
  readCronJobs,
  readMonitors,
  type SessionMonitor,
  readSessions,
  resolveOfflineSession,
  deleteSession,
  duplicateSession,
  readTranscriptMeta,
  sessionLabel as label,
  setSessionName,
  transcriptPath,
  transcriptProjectCwd,
  type SessionCron,
  type SessionInfo,
} from "../../lib/sessions";
import { deliver, liveSessions, pauseSession, unpauseSession } from "../../lib/peer";

type ForkResult = Awaited<ReturnType<typeof duplicateSession>>;

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
  stop: z
    .boolean()
    .optional()
    .default(false)
    .describe("Kill the target session's process (online sessions only)"),
  pause: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Freeze (SIGSTOP) the target session's process without killing it — the session stays alive; paused sessions auto-resume (SIGCONT) on inbound messages",
    ),
  unpause: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Wake a frozen (SIGSTOP'd) session with SIGCONT (online sessions only); paused sessions also auto-resume on inbound messages",
    ),
  delete: z
    .boolean()
    .optional()
    .default(false)
    .describe("Delete the session's transcript and pinned name (offline sessions only unless --force)"),
  "stop-all-monitor": z
    .boolean()
    .optional()
    .default(false)
    .describe("Ask the owning session to stop all of its background monitors via TaskStop (session-only; requires it online)"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Allow deleting an online session's transcript (implies --delete)"),
  duplicate: z
    .boolean()
    .optional()
    .default(false)
    .describe("Fork the session's transcript (and pinned name) into a new session"),
});

export type SessionArgs = z.infer<typeof SessionArgsSchema>;

export interface SessionDeps {
  readSessions?: (all: boolean) => Promise<SessionInfo[]>;
  killSession?: (pid: number, signal: NodeJS.Signals | 0) => void;
  forkSession?: (s: SessionInfo) => Promise<ForkResult>;
}

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

function monitorLines(monitors: SessionMonitor[], online: boolean): string[] {
  if (monitors.length === 0) return [row("monitor", "none")];

  const note = online ? "session-only" : "last known · session-only monitors ended";
  const lines = [row("monitor", `${monitors.length} running · ${note}`)];
  for (const m of monitors) {
    lines.push(`    ${m.id}  ${m.description ?? ""}`.trimEnd());
  }
  return lines;
}

function howToTalk(name: string): string {
  return ["💡 Talk to this session:", `  use-code-cli talk ${name} "your message"`].join("\n");
}

/** Rename one resolved session, refusing a name another session already holds. */
async function performSessionUpdate(
  s: SessionInfo,
  newName: string | undefined,
  newCwd: string | undefined,
  readSessionsFn: (all: boolean) => Promise<SessionInfo[]>,
) {
  const lines: string[] = [];

  if (newName !== undefined) {
    const taken = (await readSessionsFn(true)).find(
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

async function session(args: SessionArgs, deps?: SessionDeps) {
  const readSessionsFn = deps?.readSessions ?? readSessions;
  const killFn = deps?.killSession ?? ((pid: number, signal: NodeJS.Signals | 0) => process.kill(pid, signal));
  const live = await readSessionsFn(false);
  let matches = findSessions(live, args.target);
  if (matches.length === 0) {
    // Fast path: direct lookup by sessionId (offline) avoids the full scan.
    const off = await resolveOfflineSession(args.target);
    if (off) {
      matches = [off];
    } else {
      // Fall back to the full scan for name/prefix matching.
      matches = findSessions(await readSessionsFn(true), args.target);
    }
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

  if (args["stop-all-monitor"]) {
    if (!s.online) {
      return {
        success: false,
        message: `Session ${label(s)} is offline; monitors are session-only. Start it and run TaskStop inside it.`,
      };
    }
    const monitors = await readMonitors(s);
    if (monitors.length === 0) {
      return { success: true, message: `Session ${label(s)} has no active monitors.` };
    }
    const live = await liveSessions();
    const session = live.find((x) => x.sessionId === s.sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${label(s)} is not reachable for messaging. Run TaskStop({task_id: "..."}) inside it for: ${monitors.map((m) => m.id).join(", ")}.`,
      };
    }
    const ids = monitors.map((m) => m.id);
    try {
      await deliver(
        session,
        `Please stop all background monitors by calling TaskStop for each: ${ids
          .map((id) => `${id}`)
          .join(", ")}. (Monitors: ${monitors.map((m) => `${m.id} ("${m.description ?? ""}")`).join("; ")})`,
      );
      return {
        success: true,
        message: `Asked session ${label(s)} to stop ${monitors.length} monitor${monitors.length === 1 ? "" : "s"}: ${ids.join(", ")}.`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Could not message session ${label(s)}: ${reason}. Run TaskStop inside it for: ${ids.join(", ")}.`,
      };
    }
  }

  if (args.delete || args.force) {
    if (s.online && !args.force) {
      return {
        success: false,
        message: `Session ${label(s)} is still active (pid ${s.pid}); pass --force to delete its transcript anyway, or stop it first with --stop.`,
      };
    }
    const { transcriptRemoved } = await deleteSession(s);
    const lines = [`Deleted session ${label(s)} (${s.sessionId}).`];
    lines.push(transcriptRemoved ? "Transcript removed." : "No transcript found; nothing to remove.");
    lines.push("Pinned name cleared from the registry (if present).");
    return { success: true, message: lines.join("\n"), data: { sessionId: s.sessionId, deleted: true } };
  }

  // Duplicate mode: fork the session's transcript (and pinned name) into a new session.
  if (args.duplicate) {
    const dup = await (deps?.forkSession ?? duplicateSession)(s);
    const resumeDir = await transcriptProjectCwd(s);
    const name = dup.pinnedName ?? label(s);
    const lines = [`Duplicated session ${label(s)} → ${dup.newSessionId}`];
    if (dup.transcriptPath) lines.push(`Transcript: ${dup.transcriptPath}`);
    lines.push(`Pinned name: ${name}`);
    lines.push(`Resume in Claude Code: cd ${resumeDir ?? s.cwd} && claude --resume ${name}`);
    lines.push(
      ` (Claude Code searches the current project by default; from another directory, run the cd above.)`,
    );
    return {
      success: true,
      message: lines.join("\n"),
      data: {
        originalSessionId: s.sessionId,
        newSessionId: dup.newSessionId,
        transcriptPath: dup.transcriptPath ?? null,
        pinnedName: name,
      },
    };
  }

  // Pause mode: freeze the process (SIGSTOP) without killing the session.
  if (args.pause) return pauseSession(s);

  // Unpause mode: wake a frozen (SIGSTOP'd) process with SIGCONT.
  if (args.unpause) return unpauseSession(s);

  // Stop mode: kill the session's process.
  if (args.stop) {
    if (!s.online) {
      return {
        success: false,
        message: `Session ${label(s)} is offline; cannot stop it. (Only active sessions can be stopped.)`,
      };
    }
    try {
      // Wake a stopped (SIGSTOP'd) process so the terminate signal is delivered.
      try { killFn(s.pid, "SIGCONT"); } catch { /* ignore */ }
      let termErr: string | undefined;
      try {
        killFn(s.pid, "SIGTERM");
      } catch (err) {
        // EPERM etc. — the signal never landed; report it instead of faking success.
        termErr = err instanceof Error ? err.message : String(err);
      }
      if (termErr !== undefined) {
        return {
          success: false,
          message: `Could not stop session ${label(s)} (pid ${s.pid}): ${termErr}.`,
        };
      }
      // Give it a moment to exit gracefully; escalate to SIGKILL if needed.
      for (let i = 0; i < 10; i++) {
        try { killFn(s.pid, 0); } catch { break; }
        Bun.sleepSync(50);
      }
      try { killFn(s.pid, "SIGKILL"); } catch { /* ignore */ }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Could not stop session ${label(s)} (pid ${s.pid}): ${reason}.`,
      };
    }
    return {
      success: true,
      message: `Killed session ${label(s)} (pid ${s.pid}).`,
      data: { sessionId: s.sessionId, pid: s.pid, name: label(s) },
    };
  }

  if (args.rename !== undefined || args.cwd !== undefined) {
    return performSessionUpdate(s, args.rename, args.cwd, readSessionsFn);
  }
  const rawFile = await transcriptPath(s);
  // Fast path for offline sessions: skip transcript metadata/cron/monitor reads
  // (only transcriptPath + basic fields are needed by the web status path).
  const meta = s.online ? await readTranscriptMeta(s) : { branch: undefined, hero: undefined, lastPrompt: undefined };
  const crons = s.online ? await readCronJobs(s) : [];
  const monitors = s.online ? await readMonitors(s) : [];
  const name = label(s);

  const state = s.online ? `${s.status ?? "unknown"}${s.status === "waiting" && s.waitingFor ? " — " + s.waitingFor : ""} · active` : "offline";
  const lines = [
    name,
    row("state", state),
    ...(s.online ? [row("pid", String(s.pid))] : []),
    row("name", name),
    ...(s.nameSource === "user" ? [row("name source", "user (--rename)")] : []),
    row("sessionId", s.sessionId),
    row("workspace", s.cwd),
    row("branch", meta.branch),
    row("hero", meta.hero),
    row("last prompt", meta.lastPrompt ? `"${oneLine(meta.lastPrompt, 100)}"` : undefined),
    row("transcript", rawFile),
    row("version", s.version),
    row("started", s.startedAt ? `${formatTime(s.startedAt)} (${ago(s.startedAt)})` : undefined),
    row("updated", s.updatedAt ? `${formatTime(s.updatedAt)} (${ago(s.updatedAt)})` : undefined),
    ...cronLines(crons, s.online),
    ...monitorLines(monitors, s.online),
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
      waitingFor: s.waitingFor ?? null,
      stopped: s.stopped ?? false,
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
      monitors: monitors.map((m) => ({
        id: m.id,
        description: m.description ?? null,
        timeoutMs: m.timeoutMs ?? null,
        createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
      })),
    },
  };
}

export const sessionCommand: CLICommand<SessionDeps, SessionArgs, any> = {
  name: "session",
  description: "Show one session's workspace, hero, cron jobs, and how to talk to it; --pause freezes (SIGSTOP), --unpause wakes (SIGCONT); paused sessions auto-resume on inbound messages; --stop kills the session",
  inputSchema: SessionArgsSchema,
  positionalKeys: ["target"],
  execute: (args) => session(args as SessionArgs),
  create: (deps) => (args) => session(args as SessionArgs, deps),
  examples: [
    "use-code-cli session 12345 --json",
    "use-code-cli session design-tool-05 --rename fix-auth",
    "use-code-cli session po-my-project --cwd /home/user/workspace/my-project",
    "use-code-cli session design-tool-05 --stop",
    "use-code-cli session 123e4567-e89b-42d3-a456-426614174000 --pause",
  ],
};
