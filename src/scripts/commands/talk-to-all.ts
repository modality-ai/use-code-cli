import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { deliver, liveSessions } from "../../lib/peer";

const TalkToAllArgsSchema = z.object({
  message: z.string().min(1).describe("Message to deliver to every active session's agent"),
  self: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also send to the session running this command (skipped by default)"),
});

type TalkToAllArgs = z.infer<typeof TalkToAllArgsSchema>;

async function talkToAll(args: TalkToAllArgs) {
  const all = await liveSessions();
  // The calling Claude session is this process's ancestor; skip it unless --self.
  const skip = new Set<number>();
  if (!args.self) {
    skip.add(process.pid);
    skip.add(process.ppid);
  }
  const targets = all.filter((s) => !skip.has(s.pid));

  if (targets.length === 0) {
    return { success: false, message: "No active sessions to send to. Try: use-code-cli sessions" };
  }

  const results = await Promise.all(
    targets.map(async (s) => {
      const label = s.name ?? s.sessionId;
      try {
        const msgId = await deliver(s, args.message);
        return { ok: true, pid: s.pid, name: label, msgId, error: "" };
      } catch (err) {
        return { ok: false, pid: s.pid, name: label, msgId: "", error: (err as Error).message };
      }
    }),
  );

  const sent = results.filter((r) => r.ok).length;
  const lines = results.map((r) =>
    r.ok ? `  ok    ${r.name} (pid ${r.pid})` : `  FAIL  ${r.name} (pid ${r.pid}): ${r.error}`,
  );
  return {
    success: sent > 0,
    message: `Sent to ${sent}/${results.length} active sessions\n${lines.join("\n")}`,
    data: results,
  };
}

export const talkToAllCommand: CLICommand = {
  name: "talk-to-all",
  aliases: ["send-all", "broadcast"],
  description: "Talk to all active Claude Code sessions",
  inputSchema: TalkToAllArgsSchema,
  positionalKeys: ["message"],
  execute: talkToAll,
  examples: ['use-code-cli talk-to-all "please commit and push your work"', 'use-code-cli talk-to-all "hello" --self'],
};
