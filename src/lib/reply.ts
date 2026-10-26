import {
  MAX_REPLY_HOP,
  REPLY_COMMAND,
  REPLY_MARKER_TAG,
} from "../config/constants";

/**
 * Invisible metadata carried by every annotated message, so a receiver — or
 * this CLI, when the message is quoted back — can recognise an automatic reply
 * without guessing from the prose.
 *
 *   <!-- use-code-cli:auto-reply hop=1 id=<msg_id> re=<msg_id> -->
 */
const MARKER_RE = new RegExp(`<!--\\s*${REPLY_MARKER_TAG}([^>]*)-->`, "g");

export interface ReplyMeta {
  /** Automatic reply hops that produced this message. */
  hop: number;
  /** msg_id of the annotated message. */
  id?: string;
  /** msg_id the annotated message answers. */
  inReplyTo?: string;
}

export interface ReplyOptions {
  /** msg_id to record on the message, so the peer can answer it by id. */
  msgId?: string;
  /** msg_id this message answers. */
  inReplyTo?: string;
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}=([^\\s>]+)`).exec(attrs)?.[1];
}

/**
 * Read the marker the CLI appends to an annotated message. The last marker
 * wins: a quoted older one must not mask the newest.
 */
export function parseReplyMeta(message: string): ReplyMeta | undefined {
  let attrs: string | undefined;
  for (const match of message.matchAll(MARKER_RE)) attrs = match[1];
  if (attrs === undefined) return undefined;

  const hop = Number.parseInt(attr(attrs, "hop") ?? "", 10);
  return {
    hop: Number.isFinite(hop) ? hop : MAX_REPLY_HOP,
    id: attr(attrs, "id"),
    inReplyTo: attr(attrs, "re"),
  };
}

/** Remove every marker, keeping the human-readable message intact. */
export function stripReplyMarkers(message: string): string {
  return message
    .replace(MARKER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** True when the message is one this CLI already annotated as a reply. */
export function isAutoReply(message: string): boolean {
  const meta = parseReplyMeta(message);
  return meta !== undefined && meta.hop >= MAX_REPLY_HOP;
}

/**
 * The sentence appended to an outgoing message by default.
 *
 * It carries `--one-way` on purpose: the peer's answer is terminal, so the
 * peer answering it produces no new instruction to answer. That single flag is
 * what keeps a two-session conversation from bouncing forever.
 */
export function replyInstruction(senderName: string): string {
  return `When you're done, report back with ${'`'}${REPLY_COMMAND} ${senderName} "<your answer>" --one-way${'`'}`;
}

/**
 * True when the message already tells the peer how to reply and how to keep
 * the chain closed.
 *
 * The command alone is not enough: a message that merely quotes a log
 * mentioning `use-code-cli talk` still needs an instruction, otherwise the
 * peer never learns how to answer. Only an actual `--one-way` or
 * `--in-reply-to` phrase marks a real instruction.
 */
export function hasReplyInstruction(message: string): boolean {
  return /use-code-cli\s+talk\b[^\n]*--(?:one-way|in-reply-to)\b/.test(message);
}

/** The marker line for an annotated message. */
export function replyMarker(hop: number, options: ReplyOptions = {}): string {
  const attrs = [`hop=${hop}`];
  if (options.msgId) attrs.push(`id=${options.msgId}`);
  if (options.inReplyTo) attrs.push(`re=${options.inReplyTo}`);
  return `<!-- ${REPLY_MARKER_TAG} ${attrs.join(" ")} -->`;
}

/**
 * Append the reply instruction unless the sender is unknown, the message
 * unknown, the message already carries an instruction, or the message is
 * itself an automatic reply. Pure: safe to unit test.
 */
export function appendReplyInstruction(
  message: string,
  senderName: string | undefined,
  options: ReplyOptions = {},
): string {
  if (!senderName) return message;
  if (hasReplyInstruction(message)) return message;
  if (isAutoReply(message)) return message;

  // A hop=0 marker is a plain message asking to be annotated; replacing it
  // keeps exactly one marker on the wire.
  const meta = parseReplyMeta(message);
  const base = meta ? stripReplyMarkers(message) : message;
  return `${base}\n\n${replyInstruction(senderName)}\n${replyMarker(MAX_REPLY_HOP, options)}`;
}
