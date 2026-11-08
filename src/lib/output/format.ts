/** Shared presentation helpers for command output. */

/** Escape HTML special characters in a string. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render raw tool output as a pre block: terminal text loses meaning when
 *  markdown re-wraps it into paragraphs (newlines collapse, code becomes prose). */
export function preHtml(text: string): string {
  return `<pre class="whitespace-pre-wrap">${escHtml(text)}</pre>`;
}

/** Collapse whitespace and clip to `max` characters with an ellipsis. */
export function oneLine(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** A count with a pluralised word, e.g. `3 sessions` / `1 session`. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** `sv-SE` local time to the second, or "" when the timestamp is absent. */
export function formatTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("sv-SE").slice(0, 19);
}
