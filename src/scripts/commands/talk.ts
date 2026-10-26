import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import {
  ancestorPids,
  currentSession,
  deliver,
  liveSessions,
  type LiveSession,
} from "../../lib/peer";
import {
  appendReplyInstruction,
  hasReplyInstruction,
  isAutoReply,
  parseReplyMeta,
} from "../../lib/reply";
import {
  clearInbound,
  findReply,
  hasPendingInbound,
  markInbound,
  recordReply,
} from "../../lib/reply-ledger";

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
  reply: z
    .boolean()
    .optional()
    .describe(
      "Append a reply instruction — e.g. \"When you're done, report back with use-code-cli talk <sender> \\\"<your answer>\\\" --one-way\". On by default, but off when this session just received an automatic reply. --reply forces it on.",
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

type ReplyHint =
  | "appended"
  | "already-present"
  | "auto-reply"
  | "auto-disabled"
  | "disabled"
  | "skipped-no-sender";

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
  const inReplyTo = args["in-reply-to"];

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

  // One inbound message, one answer: a retry or a second relay must not send
  // the same reply again, which is how chains start looping.
  if (inReplyTo && !args.force) {
    const previous = await findReply(inReplyTo, session.sessionId);
    if (previous) {
      return {
        success: false,
        message: `Already replied to msg_id=${inReplyTo} for ${label(session)} at ${new Date(previous.at).toISOString()} (msg_id=${previous.msgId}). Pass --force to send again.`,
      };
    }
  }

  const sender = await currentSession(sessions);
  const senderName = sender ? label(sender) : undefined;

  // Resolve the effective default. An explicit flag wins. Otherwise a session
  // that just received an automatic reply stays conservative: its answer goes
  // out without an instruction, so loop safety does not depend on the agent
  // reading the prose in the inbound message.
  let replyHint: ReplyHint;
  if (args["one-way"]) {
    replyHint = "disabled";
  } else if (args.reply !== true && sender && (await hasPendingInbound(sender.sessionId))) {
    replyHint = "auto-disabled";
  } else if (!senderName) {
    replyHint = "skipped-no-sender";
  } else if (hasReplyInstruction(message)) {
    replyHint = "already-present";
  } else if (isAutoReply(message)) {
    replyHint = "auto-reply";
  } else {
    replyHint = "appended";
  }

  const msgId = randomUUID();
  const body =
    replyHint === "appended"
      ? appendReplyInstruction(message, senderName, { msgId, inReplyTo })
      : message;

  try {
    await deliver(session, body, msgId);
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }

  const notes: string[] = [];
  if (replyHint === "skipped-no-sender") {
    notes.push("could not determine the sender session — reply instruction skipped.");
  }
  if (replyHint === "auto-reply") {
    notes.push("message looks like an automatic reply — no reply instruction appended.");
  }
  if (replyHint === "auto-disabled") {
    notes.push(
      "this session recently received an automatic reply — reply instruction suppressed by default. Pass --reply to force it.",
    );
  }

  if (inReplyTo) {
    try {
      await recordReply({
        inReplyTo,
        targetSessionId: session.sessionId,
        msgId,
        at: Date.now(),
      });
    } catch (err) {
      notes.push(
        `LEDGER NOT UPDATED (${(err as Error).message}): a duplicate answer to msg_id=${inReplyTo} will not be blocked.`,
      );
    }
  }

  // The target now holds a message with a loop marker; its next reply should be
  // conservative. The sender answered, so its own mark can be cleared.
  if (parseReplyMeta(body)) {
    try {
      await markInbound(session.sessionId);
    } catch (err) {
      notes.push(
        `LOOP SAFETY DEGRADED (${(err as Error).message}): ${label(session)} was not marked as holding an automatic reply.`,
      );
    }
  }
  if (sender) {
    try {
      await clearInbound(sender.sessionId);
    } catch (err) {
      notes.push(
        `LOOP SAFETY DEGRADED (${(err as Error).message}): this session's inbound mark was not cleared.`,
      );
    }
  }

  const note = notes.map((n) => `\nNote: ${n}`).join("");

  return {
    success: true,
    message: `Sent to ${label(session)} (pid ${session.pid}) msg_id=${msgId}${note}`,
    data: {
      pid: session.pid,
      sessionId: session.sessionId,
      msgId,
      sender: senderName ?? null,
      inReplyTo: inReplyTo ?? null,
      replyHint,
    },
  };
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
