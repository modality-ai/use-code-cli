import { cleanPrompt } from "./prompt";

export interface TranscriptTool {
  name: string;
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

/** Parse Claude Code JSONL transcript lines into chat entries (user/assistant with tool use). */
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
              if (e.tools && e.tools[ref.toolIdx]) { (e.tools[ref.toolIdx] as any).result = resText; (e.tools[ref.toolIdx] as any).resultHtml = Bun.markdown.html(resText); }
            }
          }
        }
        // also capture any text
        const text = cleanPrompt(
          Array.isArray(content)
            ? content.filter((b: any) => b && b.type === "text").map((b: any) => b.text || "").join("\n")
            : ""
        );
        if (text) entries.push({ role: "user", text, html: Bun.markdown.html(text) });
      } else {
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content.filter((b: any) => b && b.type === "text").map((b: any) => b.text || "").join("\n");
        }
        text = cleanPrompt(text);
        if (text) entries.push({ role: "user", text, html: Bun.markdown.html(text) });
      }
    } else if (obj.type === "assistant" && obj.message) {
      const content = obj.message.content;
      const texts: string[] = [];
      const tools: { name: string; input?: any }[] = [];
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text" && b.text) texts.push(b.text);
          if (b?.type === "tool_use") {
            const idx = tools.length;
            tools.push({ name: b.name || "tool", input: b.input });
            if (b.id) {
              // record placeholder; entry not pushed yet
              toolIndex.set(b.id, { entryIdx: entries.length, toolIdx: idx });
            }
          }
        }
      } else if (typeof content === "string") {
        texts.push(content);
      }
      const text = texts.join("\n").trim();
      if (text || tools.length) {
        entries.push({ role: "assistant", text, html: text ? Bun.markdown.html(text) : "", tools: tools.length ? tools : undefined });
      }
    } else if (obj.type === "system" && obj.subtype === "away_summary") {
      const content = typeof obj.content === "string" ? obj.content : "";
      // Strip <think>...</think> reasoning tags, keep the recap text
      const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (cleaned) {
        entries.push({ role: "system", text: cleaned, html: Bun.markdown.html(cleaned) });
      }
    }
  }

  return entries;
}
