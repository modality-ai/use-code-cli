import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import {
  ancestorPids,
  currentSession,
  deliver,
  liveSessions,
  type LiveSession,
} from "../../lib/peer";
import { appendReplyInstruction, hasReplyInstruction } from "../../lib/reply";

const TalkArgsSchema = z.object({
  target: z
    .string()
    .optional()
    .describe("Session name, pid, or sessionId — omit to use the only active session"),
  message: z
    .string()
    .min(1)
    .optional()
    .describe("Message to deliver to the session's agent"),
  reply: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Append a reply instruction (default: on) — e.g. \"When you're done, report back with use-code-cli talk <sender>\". Pass --no-reply to send the message as written.",
    ),
});

type TalkArgs = z.infer<typeof TalkArgsSchema>;

function label(s: LiveSession): string {
  return s.name ?? s.sessionId;
}

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

  // `talk "hello"` parses as a lone target. When it names no session it is the
  // message, and the target is picked automatically; when it does name one the
  // user simply forgot the message.
  if (message === undefined && target !== undefined) {
    if (findTargets(sessions, target).length > 0) {
      return {
        success: false,
        message: `Message required. Usage: use-code-cli talk ${target} "your message"`,
      };
    }
    message = target;
    target = undefined;
  }

  if (message === undefined) {
    return {
      success: false,
      message: 'Message required. Usage: use-code-cli talk [target] "your message"',
    };
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

  let senderName: string | undefined;
  let replyHint: "appended" | "already-present" | "disabled" | "skipped-no-sender" =
    "disabled";
  if (args.reply !== false) {
    const sender = await currentSession(sessions);
    if (!sender) {
      replyHint = "skipped-no-sender";
    } else {
      senderName = label(sender);
      replyHint = hasReplyInstruction(message) ? "already-present" : "appended";
    }
  }
  const body =
    replyHint === "appended"
      ? appendReplyInstruction(message, senderName)
      : message;

  try {
    const msgId = await deliver(session, body);
    const note =
      replyHint === "skipped-no-sender"
        ? "\nNote: could not determine the sender session — reply instruction skipped."
        : "";
    return {
      success: true,
      message: `Sent to ${label(session)} (pid ${session.pid}) msg_id=${msgId}${note}`,
      data: {
        pid: session.pid,
        sessionId: session.sessionId,
        msgId,
        sender: senderName ?? null,
        replyHint,
      },
    };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export const talkCommand: CLICommand = {
  name: "talk",
  description: "Talk to an active Claude Code session (auto-picks the only one)",
  inputSchema: TalkArgsSchema,
  usage: ['use-code-cli talk [target] "message" [--no-reply]'],
  positionalKeys: ["target", "message"],
  execute: talk,
  examples: [
    'use-code-cli talk "run the tests and report"',
    'use-code-cli talk use-stock-3a "run the tests and report"',
    'use-code-cli talk use-stock-3a "FYI only" --no-reply',
  ],
};
