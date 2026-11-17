import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { ancestorPids, liveSessions, type LiveSession } from "../../lib/peer";
import { sendWithReply } from "../../lib/reply-send";
import { readStdinMessageOrUndefined } from "../../lib/talk-argv";
import { sessionLabel as label } from "../../lib/sessions";

const TalkArgsSchema = z.object({
  target: z
    .string()
    .optional()
    .describe("Session name, pid, or sessionId — omit to use the only active session"),
  message: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Message to deliver to the session's agent. For literal text use '--- <message>' or stdin: the shell still expands $VAR, backticks and ! in unquoted words.",
    ),
  // Quoted, kebab-case key: the CLI normalises camelCase fields to `--kebab-case`
  // flags, so a camelCase key here would never receive the flag's value.
  "one-way": z
    .boolean()
    .optional()
    .describe("Send the message exactly as written — no reply instruction appended."),
  "in-reply-to": z
    .string()
    .optional()
    .describe(
      "msg_id of the message this answers — recorded so the same session cannot answer it twice",
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Send even when this session already answered --in-reply-to"),
});

type TalkArgs = z.infer<typeof TalkArgsSchema>;

function findTargets(sessions: LiveSession[], target: string): LiveSession[] {
  return sessions.filter(
    (s) =>
      String(s.pid) === target ||
      s.sessionId === target ||
      s.name === target,
  );
}

function describeAll(sessions: LiveSession[]): string {
  return sessions.map((s) => `  ${s.pid} ${label(s)} ${s.cwd}`).join("\n");
}

/** Every live session except the one that launched this CLI. */
function autoTargets(sessions: LiveSession[]): LiveSession[] {
  const ancestors = ancestorPids();
  return sessions.filter((s) => !ancestors.has(s.pid));
}

async function talk(args: TalkArgs) {
  const sessions = await liveSessions();
  let { target, message } = args;
  const inReplyTo = args["in-reply-to"];

  // `talk "hello"` parses as a lone target. When it names no session it is the
  // message, and the target is picked automatically; when it does name one the
  // message comes from piped stdin, read below once the session is resolved.
  if (
    message === undefined &&
    target !== undefined &&
    findTargets(sessions, target).length === 0
  ) {
    message = target;
    target = undefined;
  }

  let session: LiveSession | undefined;
  if (target !== undefined) {
    const matches = findTargets(sessions, target);
    if (matches.length > 1) {
      return {
        success: false,
        message: `"${target}" is ambiguous; use a pid:\n${describeAll(matches)}`,
      };
    }
    session = matches[0];
    if (!session) {
      return {
        success: false,
        message: `No active session matches "${target}". Try: use-code-cli sessions`,
      };
    }
  } else {
    const candidates = autoTargets(sessions);
    if (candidates.length > 1) {
      return {
        success: false,
        message: `${candidates.length} active sessions — add a target:\n${describeAll(candidates)}`,
      };
    }
    session = candidates[0];
    if (!session) {
      return {
        success: false,
        message:
          sessions.length > 0
            ? "No other active sessions (the sender is the only one). Try: use-code-cli sessions"
            : "No active sessions. Try: use-code-cli sessions",
      };
    }
  }

  if (message === undefined) {
    // Piped or heredoc stdin carries the message when the argument is omitted;
    // on a terminal or blank input there is nothing to read.
    message = await readStdinMessageOrUndefined();
    if (message === undefined) {
      return {
        success: false,
        message:
          target !== undefined
            ? `Message required. Usage: use-code-cli talk ${target} "your message"`
            : 'Message required. Usage: use-code-cli talk [target] "your message"',
      };
    }
  }

  return sendWithReply({
    session,
    message,
    sessions,
    oneWay: args["one-way"],
    inReplyTo,
    force: args.force,
  });
}

export const talkCommand: CLICommand = {
  name: "talk",
  description: "Talk to an active Claude Code session (auto-picks the only one)",
  inputSchema: TalkArgsSchema,
  usage: [
    'use-code-cli talk [target] "message" [--one-way] [--in-reply-to <msg_id>]',
    'use-code-cli talk [target] [flags] --- message text (literal; stdin if empty)',
  ],
  positionalKeys: ["target", "message"],
  execute: talk,
  examples: [
    'use-code-cli talk "run the tests and report"',
    'use-code-cli talk use-stock-3a --one-way --- exactly this text, --one-way and all',
    'use-code-cli talk use-stock-3a --- < message.txt',
    'use-code-cli talk use-stock-3a "done" --in-reply-to 1f0c… --one-way',
  ],
};
