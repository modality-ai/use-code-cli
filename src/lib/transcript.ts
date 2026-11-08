import { cleanPrompt } from "./prompt";
import { colorDiffHtml, resolveEditStartLine } from "./output/color-diff";

export interface TranscriptTool {
  name: string;
  id?: string;
  input?: any;
  result?: string;
  resultHtml?: string;
}

export interface TranscriptEntry {
  role: string;
  text: string;
  html?: string;
  tools?: TranscriptTool[];
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Raw HTML passes through CommonMark unchanged, so the rendered output can
 * carry markup from the transcript source. Whitelist strategy: only tags
 * markdown itself generates survive; every other raw tag becomes inert text.
 * This keeps source-quoted chrome (a tool result quoting "<summary>" or
 * "</details>") from reparenting the client's <details>/<summary> folds and
 * keeps swallowing elements (script/style rawtext) from eating siblings.
 */
const MD_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
  "pre", "code", "em", "strong", "del", "a", "img", "br", "hr",
  "table", "thead", "tbody", "tr", "th", "td", "input",
  "span", "b", "i", "s", "sub", "sup", "section",
]);

/**
 * Balance guarantee: `code` is an HTML formatting element, so one unclosed
 * <code> (Bun markdown can emit it for an unpaired backtick) would stay on the
 * parser's active-formatting list and get RE-OPENED inside the next sibling's
 * markup — e.g. wrapping the pinned row's spans. Stack-tracking opens and
 * closing everything still open at the end makes every sanitized payload
 * self-contained, so nothing can leak across entry boundaries.
 */
const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

function sanitizeHtml(html: string): string {
  const stack: string[] = [];
  const body = html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g,
    (m, close: string, tag: string, attrs: string, self: string): string => {
      const t = tag.toLowerCase();
      if (!MD_TAGS.has(t)) return escHtml(m); // inert text: no reparent, no swallow
      const clean = attrs
        .replace(/\son[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(
          /\s(href|src|action|formaction|xlink:href)\s*=\s*("|')?\s*(?:javascript|vbscript):[^\s"'<>]*/gi,
          ' $1="#"',
        );
      if (close) {
        const i = stack.lastIndexOf(t);
        if (i === -1) return escHtml(m); // stray close: inert, keeps balance
        let emit = "";
        for (let j = stack.length - 1; j > i; j--) emit += `</${stack[j]!}>`;
        stack.length = i;
        return emit + `</${t}>`;
      }
      if (self || VOID_TAGS.has(t)) return `<${t}${clean}>`;
      stack.push(t);
      return `<${t}${clean}>`;
    },
  );
  // close whatever raw inline HTML left open: unclosed formatting elements
  // (code/b/i/em/strong) otherwise re-open inside the next sibling's markup
  let tail = "";
  while (stack.length) tail += `</${stack.pop()!}>`;
  return body + tail;
}

/** Cap a tool result at display size; the full text remains on disk. */
const MAX_RESULT_CHARS = 20_000;
function trimResult(text: string): string {
  return text.length <= MAX_RESULT_CHARS
    ? text
    : text.slice(0, MAX_RESULT_CHARS) +
        `\n… truncated for display (${(text.length - MAX_RESULT_CHARS).toLocaleString()} more chars in the raw transcript)`;
}

/**
 * Render text as markdown HTML safely: markdown handles escaping per context
 * (code spans must show "<" as-is), then the output is sanitized so raw inline
 * HTML from the transcript can't swallow or execute when the client
 * innerHTMLs the payload.
 */
function mdHtml(text: string): string {
  return sanitizeHtml(Bun.markdown.html(text));
}

/** Remove inline reasoning tags, keeping the visible text around them. */
function stripThinkTags(text: string): string {
  // Paired tags: remove the block, keep the surrounding text.
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Unclosed tag at the start (reasoning echoed with no closer): the real
  // message resumes after the block's terminating blank line — chop to
  // end-of-text only when nothing follows.
  const open = out.indexOf("<think>");
  if (open !== -1) {
    const tail = out.slice(open + 7);
    const nl = tail.search(/\n\s*\n/);
    out = out.slice(0, open) + (nl !== -1 ? tail.slice(nl) : "");
  }
  return out.trim();
}

/**
 * Keep only the recap text from an away_summary body. Observed shapes: the
 * instruction preamble and the recap share one think block (closed or not,
 * with junk after a second blank line or after a misplaced closer), or an
 * early closer leaves the recap outside. The recap resumes after the block's
 * terminating blank line and stops at the next blank line; a block without
 * a blank line defers to the text outside the closer.
 */
function recapText(text: string): string {
  const OPEN_TAG = "<think>";
  const CLOSE_TAG = "</think>";
  const o = text.indexOf(OPEN_TAG);
  if (o === -1) return stripThinkTags(text);
  const c = text.indexOf(CLOSE_TAG, o + OPEN_TAG.length);
  const inner = c === -1 ? text.slice(o + OPEN_TAG.length) : text.slice(o + OPEN_TAG.length, c);
  const outer = c === -1 ? text.slice(0, o) : text.slice(c + CLOSE_TAG.length);
  const nl = inner.search(/\n\s*\n/);
  let recap = "";
  if (nl !== -1) {
    const rest = inner.slice(nl).replace(/^\s*\n/, "");
    const cut = rest.search(/\n\s*\n/);
    recap = (cut === -1 ? rest : rest.slice(0, cut)).trim();
  }
  return recap || outer.trim();
}

export function parseTranscript(lines: string[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  // map tool_use_id -> index in entries tools for attaching results
  const toolIndex = new Map<string, { entryIdx: number; toolIdx: number }>();

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "user" && obj.message) {
      const content = obj.message.content;
      if (Array.isArray(content) && content.some((b: any) => b?.type === "tool_result")) {
        for (const b of content) {
          if (b?.type === "tool_result") {
            const id = b.tool_use_id;
            const resText = typeof b.content === "string" ? b.content : (Array.isArray(b.content) ? b.content.map((x: any) => x?.text || "").join("\n") : "");
            const ref = toolIndex.get(id);
            if (ref) {
              const e = entries[ref.entryIdx]!;
              if (e.tools && e.tools[ref.toolIdx]) {
                // Cap display size: one huge result rendered as a fold can
                // lock a tab (a 50k-line open <pre> freezes layout outright).
                // The full text stays in the raw transcript on disk.
                const shown = trimResult(resText);
                const toolObj = (e.tools[ref.toolIdx] as any);
                toolObj.result = shown;
                const tname = String(toolObj.name || "").toLowerCase();
                if (tname === "edit") {
                  const fp = toolObj.input?.file_path || toolObj.input?.path;
                  const resolved = resolveEditStartLine(fp, toolObj.input?.old_string ?? "", toolObj.input?.new_string ?? "");
                  toolObj.resultHtml = colorDiffHtml(toolObj.input?.old_string ?? "", toolObj.input?.new_string ?? "", {
                    filePath: fp, lineNumbers: true,
                    oldStartLine: resolved.oldStartLine, newStartLine: resolved.newStartLine,
                    markApproximate: resolved.confidence !== "exact",
                  });
                } else if (tname === "write") {
                  toolObj.resultHtml = colorDiffHtml("", toolObj.input?.content ?? "", { filePath: toolObj.input?.file_path || toolObj.input?.path, lineNumbers: true, oldStartLine: 1, newStartLine: 1 });
                } else if (tname === "read") {
                  const fp = toolObj.input?.file_path || toolObj.input?.path;
                  // Read results already carry their own (offset-aware) line
                  // numbers, so suppress color-diff's counter and render them
                  // as neutral context lines (identical old/new, no +/-).
                  toolObj.resultHtml = shown ? colorDiffHtml(shown, shown, { filePath: fp, lineNumbers: false }) : undefined;
                } else {
                  toolObj.resultHtml = shown ? mdHtml(shown) : undefined;
                }
              }
            }
          }
        }
        // also capture any text
        const text = cleanPrompt(
          Array.isArray(content)
            ? content.filter((b: any) => b && b.type === "text").map((b: any) => b.text || "").join("\n")
            : ""
        );
        // No html payload: client renders escaped text (raw tags would execute).
        if (text) entries.push({ role: "user", text });
      } else {
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content.filter((b: any) => b && b.type === "text").map((b: any) => b.text || "").join("\n");
        }
        text = cleanPrompt(text);
        // No html payload: client renders escaped text (raw tags would execute).
        if (text) entries.push({ role: "user", text });
      }
    } else if (obj.type === "assistant" && obj.message) {
      const content = obj.message.content;
      const texts: string[] = [];
      const tools: { name: string; id?: string; input?: any }[] = [];
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text" && b.text) texts.push(b.text);
          if (b?.type === "tool_use") {
            const idx = tools.length;
            const toolObj: any = { name: b.name || "tool", id: b.id, input: b.input };
            const tname = String(toolObj.name || "").toLowerCase();
            if (tname === "edit") {
              const fp = toolObj.input?.file_path || toolObj.input?.path;
              const resolved = resolveEditStartLine(fp, toolObj.input?.old_string ?? "", toolObj.input?.new_string ?? "");
              toolObj.resultHtml = colorDiffHtml(toolObj.input?.old_string ?? "", toolObj.input?.new_string ?? "", {
                filePath: fp, lineNumbers: true,
                oldStartLine: resolved.oldStartLine, newStartLine: resolved.newStartLine,
                markApproximate: resolved.confidence !== "exact",
              });
            } else if (tname === "write") {
              toolObj.resultHtml = colorDiffHtml("", toolObj.input?.content ?? "", { filePath: toolObj.input?.file_path || toolObj.input?.path, lineNumbers: true, oldStartLine: 1, newStartLine: 1 });
            }
            tools.push(toolObj);
            if (b.id) {
              // record placeholder; entry not pushed yet
              toolIndex.set(b.id, { entryIdx: entries.length, toolIdx: idx });
            }
          }
        }
      } else if (typeof content === "string") {
        texts.push(content);
      }
      const text = stripThinkTags(texts.join("\n"));
      if (text || tools.length) {
        // Markdown only for display; text stays the plain fallback.
        entries.push({
          role: "assistant",
          text,
          html: text ? mdHtml(text) : undefined,
          tools: tools.length ? tools : undefined,
        });
      }
    } else if (obj.type === "system" && obj.subtype === "away_summary") {
      const content = typeof obj.content === "string" ? obj.content : "";
      // Strip internal reasoning tags, keep the recap text
      const cleaned = recapText(content);
      if (cleaned) {
        entries.push({ role: "system", text: cleaned });
      }
    }
  }

  return entries;
}
