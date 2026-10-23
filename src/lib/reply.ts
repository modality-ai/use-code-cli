/** The CLI invocation a peer can use to answer back. */
export const REPLY_COMMAND = "use-code-cli talk";

/** The sentence appended to an outgoing message by default. */
export function replyInstruction(senderName: string): string {
  return `When you're done, report back with ${REPLY_COMMAND} ${senderName}`;
}

/**
 * True when the message already tells the peer how to reply.
 *
 * Any mention of the talk command counts: the sender has taken care of the
 * instruction themselves, and appending a second one would duplicate it.
 */
export function hasReplyInstruction(message: string): boolean {
  return /use-code-cli\s+talk\b/.test(message);
}

/**
 * Append the reply instruction unless `--no-reply` disabled it, the sender is
 * unknown, or the message already carries one. Pure: safe to unit test.
 */
export function appendReplyInstruction(
  message: string,
  senderName: string | undefined,
): string {
  if (!senderName) return message;
  if (hasReplyInstruction(message)) return message;
  return `${message}\n\n${replyInstruction(senderName)}`;
}
