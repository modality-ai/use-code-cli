import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { readSessions } from "../../lib/sessions";

const SessionsArgsSchema = z.object({
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also list offline sessions (process no longer running)"),
});

type SessionsArgs = z.infer<typeof SessionsArgsSchema>;

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
