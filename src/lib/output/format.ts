/** Shared presentation helpers for command output. */

/** Escape HTML special characters in a string. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render raw tool output as a pre block: terminal text loses meaning when
 *  markdown re-wraps it into paragraphs (newlines collapse, code becomes prose). */
export function preHtml(text: string): string {
  // Parse <bash-stdout>...</bash-stdout> and <bash-stderr>...</bash-stderr> tags
  // emitted by bash tool results: strip the tags and colourise the streams.
  const tagRe = /<bash-(stdout|stderr)>([\s\S]*?)<\/bash-\1>/g;
  if (!tagRe.test(text)) {
    // No tags: render as before (escaped + linkified).
    const escaped = escHtml(text);
    const linked = escaped.replace(
      /(https?:\/\/[^\s<>"']+)/g,
      (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-accent underline break-all">${url}</a>`,
    );
    return `<pre class="whitespace-pre-wrap break-words">${linked}</pre>`;
  }
  // Reset regex lastIndex after test().
  tagRe.lastIndex = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    // Render any plain text between tags as before.
    if (m.index > last) {
      const between = text.slice(last, m.index);
      const escaped = escHtml(between);
      out += escaped.replace(
        /(https?:\/\/[^\s<>"']+)/g,
        (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-accent underline break-all">${url}</a>`,
      );
    }
    const stream = m[1];
    const content = m[2] ?? "";
    const escaped = escHtml(content);
    const cls = stream === "stdout" ? "text-text" : "text-red-400";
    out += `<span class="${cls}">${escaped}</span>`;
    last = m.index + m[0].length;
  }
  // Trailing plain text.
  if (last < text.length) {
    const between = text.slice(last);
    const escaped = escHtml(between);
    out += escaped.replace(
      /(https?:\/\/[^\s<>"']+)/g,
      (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-accent underline break-all">${url}</a>`,
    );
  }
  return `<pre class="whitespace-pre-wrap break-words">${out}</pre>`;
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
