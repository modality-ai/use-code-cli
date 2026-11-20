import { randomUUID } from "node:crypto";
import { currentSession, deliver, interrupt, liveSessions, type LiveSession } from "./peer";
import { appendReplyInstruction, hasReplyInstruction, isAutoReply } from "./reply";
import { findReply, recordReply } from "./reply-ledger";
import { sessionLabel as label } from "./sessions";

type ReplyHint =
  | "appended"
  | "already-present"
  | "auto-reply"
  | "disabled"
  | "skipped-no-sender";

interface SendWithReplyArgs {
  session: LiveSession;
  message: string;
  /** Live sessions for finding the sender; fetched when omitted. */
  sessions?: LiveSession[];
  oneWay?: boolean;
  inReplyTo?: string;
  force?: boolean;
  /** Injectable dependencies for testing. */
  deps?: SendWithReplyDeps;
}

export interface SendWithReplyDeps {
  findReply?: (inReplyTo: string, targetSessionId: string) => Promise<{ at: number; msgId: string } | undefined>;
  recordReply?: (record: { inReplyTo: string; targetSessionId: string; msgId: string; at: number }) => Promise<void>;
  currentSession?: (sessions?: LiveSession[]) => Promise<LiveSession | undefined>;
  liveSessions?: () => Promise<LiveSession[]>;
  deliver?: (session: LiveSession, body: string, msgId?: string, deps?: { kill?: (pid: number, signal: NodeJS.Signals) => void }) => Promise<string>;
  interrupt?: (session: LiveSession, reason?: string, deps?: { kill?: (pid: number, signal: NodeJS.Signals) => void }) => Promise<string>;
  label?: (session: LiveSession) => string;
}

/**
 * Deliver the message with the shared reply protocol: append the reply
 * instruction unless --one-way, the sender is unknown, or the text already
 * carries one; then record --in-reply-to in the ledger so the same session
 * cannot answer twice. One inbound message, one answer.
 */
export async function sendWithReply({
  session,
  message,
  sessions,
  oneWay,
  inReplyTo,
  force,
  deps,
}: SendWithReplyArgs) {
  const findReplyFn = deps?.findReply ?? findReply;
  const recordReplyFn = deps?.recordReply ?? recordReply;
  const currentSessionFn = deps?.currentSession ?? currentSession;
  const liveSessionsFn = deps?.liveSessions ?? liveSessions;
  const deliverFn = deps?.deliver ?? deliver;
  const interruptFn = deps?.interrupt ?? interrupt;
  const labelFn = deps?.label ?? label;

  if (inReplyTo && !force) {
    const previous = await findReplyFn(inReplyTo, session.sessionId);
    if (previous) {
      return {
        success: false,
        message: `Already replied to msg_id=${inReplyTo} for ${labelFn(session)} at ${new Date(previous.at).toISOString()} (msg_id=${previous.msgId}). Pass --force to send again.`,
      };
    }
  }

  const sender = await currentSessionFn(sessions ?? (await liveSessionsFn()));
  const senderName = sender ? labelFn(sender) : undefined;

  let replyHint: ReplyHint;
  if (oneWay) {
    replyHint = "disabled";
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
      ? appendReplyInstruction(message, senderName!, { msgId, inReplyTo })
      : message;

  // A busy session is mid-turn: a queued "next" message would not be seen
  // until that turn finishes. Interrupt the active turn first so the message
  // is actually processed, without changing idle behaviour.
  if (session.status === "busy") {
    try {
      await interruptFn(session);
    } catch (err) {
      // Best-effort: still attempt delivery, but surface the failure.
      console.error("reply-send: interrupt failed:", (err as Error)?.message ?? err);
    }
  }

  try {
    await deliverFn(session, body, msgId);
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

  if (inReplyTo) {
    try {
      await recordReplyFn({
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

  const note = notes.map((n) => `\nNote: ${n}`).join("");

  return {
    success: true,
    message: `Sent to ${labelFn(session)} (pid ${session.pid}) msg_id=${msgId}${note}`,
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
