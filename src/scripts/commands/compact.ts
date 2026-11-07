import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import {
  findSessions,
  readSessions,
  transcriptPath,
  compressTranscript,
  type SessionInfo,
} from "../../lib/sessions";

const CompactArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe("Session name, pid, or sessionId (a unique name prefix also works)"),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe("Replace the transcript with this compacted summary (like /compact)"),
});

type CompactArgs = z.infer<typeof CompactArgsSchema>;

function label(s: SessionInfo): string {
  return (s as any).name ?? s.sessionId;
}

async function compact(args: CompactArgs) {
  const live = await readSessions(false);
  let matches = findSessions(live, args.target);
  if (matches.length === 0) {
    matches = findSessions(await readSessions(true), args.target);
  }
  if (matches.length === 0) {
    return { success: false, message: `No session matches "${args.target}". Try: use-code-cli sessions --all` };
  }
  if (matches.length > 1) {
    const rows = matches.map((s) => `  ${label(s)}  pid=${s.pid}  ${s.cwd}`).join("\n");
    return { success: false, message: `"${args.target}" is ambiguous; use a full name or pid:\n${rows}` };
  }
  const s = matches[0]!;
  const path = await transcriptPath(s);
  if (!path) {
    return { success: false, message: `No transcript found for session ${label(s)}.` };
  }
  const r = await compressTranscript(path, args.summary);
  const lines = [
    `Compacted transcript for session ${label(s)}.`,
    `  ${path}`,
    `  ${r.originalBytes.toLocaleString()} → ${r.newBytes.toLocaleString()} bytes (${r.entries} entries)`,
  ];
  return { success: true, message: lines.join("\n"), data: { sessionId: s.sessionId, transcriptPath: path, ...r } };
}

export const compactCommand: CLICommand = {
  name: "compact",
  description: "Compact a session's transcript in place: trim bulky payloads, or replace with a summary via --summary. NOTE: When an LLM/agent invokes this command, it MUST always provide --summary — a comprehensive recap of the session so far that REPLACES the entire transcript; running without --summary only trims oversized payloads and leaves the full verbose history intact (no real compaction).",
  inputSchema: CompactArgsSchema,
  positionalKeys: ["target"],
  execute: compact,
  examples: [
    "use-code-cli compact po-use-code-cli",
    'use-code-cli compact po-use-code-cli --summary "Recap: did X and Y"',
  ],
};
