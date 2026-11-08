/** Shared, standalone JSON formatting helpers for command/tool output. */

/** Default indentation used when pretty-printing JSON. */
export const DEFAULT_JSON_INDENT = 2;

/** Pretty-print a value as JSON with indentation. */
export function prettyJson(value: unknown, indent: number = DEFAULT_JSON_INDENT): string {
  return JSON.stringify(value, null, indent);
}

/** Pretty-print a value as JSON with indentation, plus a trailing newline (for files). */
export function prettyJsonFile(value: unknown, indent: number = DEFAULT_JSON_INDENT): string {
  return `${JSON.stringify(value, null, indent)}\n`;
}

/** Returns pretty-printed JSON when `text` is valid JSON, otherwise `null`. */
export function tryPrettyJson(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.stringify(JSON.parse(text.trim()), null, DEFAULT_JSON_INDENT);
  } catch {}
  let parsedAny = false;
  const out = String(text)
    .split(/\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      try {
        const pretty = JSON.stringify(JSON.parse(trimmed), null, DEFAULT_JSON_INDENT);
        parsedAny = true;
        return pretty;
      } catch {
        return line;
      }
    });
  return parsedAny ? out.join("\n") : null;
}
