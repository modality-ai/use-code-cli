import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { formatTime, oneLine } from "../../lib/format";
import {
  findSessions,
  readSessions,
  readTranscriptMeta,
  sessionLabel as label,
  transcriptPath,
} from "../../lib/sessions";

const SessionArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe("Session name, pid, or sessionId (a unique name prefix also works)"),
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

function howToTalk(name: string): string {
  return [
    "Talk to this session from Claude Code:",
    `  !use-code-cli talk ${name} "your message"`,
    "",
    "From a shell:",
    `  use-code-cli talk ${name} "your message"`,
    "",
    "The message arrives in that session's agent as a cross-session user message;",
    "its answer is produced in that session. Inbound policy is set with",
    "`use-code-cli talk-permit` (accept | hold | refuse), and `use-code-cli sessions`",
    "lists every active session.",
  ].join("\n");
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
  const meta = await readTranscriptMeta(s);
  const rawFile = await transcriptPath(s);
  const name = label(s);

  const state = s.online ? `${s.status ?? "unknown"} · active` : "offline";
  const lines = [
    name,
    row("state", state),
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
    },
  };
}

export const sessionCommand: CLICommand = {
  name: "session",
  description: "Show one session's workspace, hero, and how to talk to it",
  inputSchema: SessionArgsSchema,
  positionalKeys: ["target"],
  execute: session,
  examples: [
    "use-code-cli session use-design-05",
    "use-code-cli session 49606 --json",
  ],
};
