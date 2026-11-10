// Shared helpers for extracting a login URL from Claude Code's streamed output.
// Kept in a separate module so they can be unit-tested without rendering React.

// Strip ANSI/OSC escape sequences (including terminal hyperlink escapes).
export function stripAnsi(s: string): string {
  return s
    // OSC sequences terminate with BEL (\x07) or ST (ESC \)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

// Strip trailing punctuation that commonly trails a URL in prose.
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[)\].,;]+$/, "");
}

export function parseLoginUrl(text: string): string | null {
  const clean = stripAnsi(text);
  const m = clean.match(/If the browser didn't open,\s*visit:\s*(https?:\/\/\S+)/i);
  if (m?.[1]) return trimTrailingPunctuation(m[1]);
  // Fallback: any http(s) URL in the chunk
  const m2 = clean.match(/(https?:\/\/[^\s<>"']+)/i);
  return m2?.[1] ? trimTrailingPunctuation(m2[1]) : null;
}
