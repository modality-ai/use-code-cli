/** The CLI invocation a peer can use to answer back. */
export const REPLY_COMMAND = "!use-code-cli talk";

/**
 * How many automatic reply hops are allowed.
 *
 * One is enough: the annotated message already asks for an answer, and asking
 * the answer for another answer is what turns two cooperative sessions into an
 * infinite ping-pong. The counter stops at the first hop.
 */
export const MAX_REPLY_HOP = 1;

/** Tag name of the invisible marker: `<!-- use-code-cli:auto-reply hop=1 ... -->`. */
export const REPLY_MARKER_TAG = "use-code-cli:auto-reply";
