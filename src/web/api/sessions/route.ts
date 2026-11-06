import { aiTool } from "../../../scripts/index";

export async function GET(): Promise<Response> {
  const result = (await aiTool.execute({ command: "sessions" })) as { success?: boolean; data?: unknown[] };
  const sessions = Array.isArray(result?.data)
    ? result.data.map((s: any) => {
        if (s && typeof s.lastPrompt === "string") {
          const cleaned = String(s.lastPrompt)
            .replace(/<\/?cross-session-message[^>]*>/g, "")
            .replace(/<!-- use-code-cli:auto-reply[^>]*-->/g, "")
            .replace(/This came from another Claude session[\s\S]*$/g, "")
            .replace(/^Another Claude session sent a message:\n/, "")
            .trim();
          return { ...s, lastPrompt: cleaned };
        }
        return s;
      })
    : [];
  return Response.json({ success: true, data: sessions });
}
