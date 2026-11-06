/** Remove cross-session messaging boilerplate from a prompt (shared by transcript + lists). */
export function cleanPrompt(text: string): string {
  return String(text || "")
    .replace(/<cross-session-message[^>]*>[\s\S]*?<\/cross-session-message>/g, "")
    .replace(/<cross-session-message[^>]*\/>/g, "")
    .replace(/<!-- use-code-cli:auto-reply[^>]*>/g, "")
    .replace(/This came from another Claude session[\s\S]*$/g, "")
    .replace(/^Another Claude session sent a message:\n/, "")
    .trim();
}
