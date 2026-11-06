import React from "react";
import { aiTool } from "../../scripts/index";

export interface Session {
  name?: string;
  sessionId?: string;
  hero?: string;
  status?: string;
  cwd?: string;
  lastPrompt?: string;
}

export interface SessionsPageProps {
  sessions: Session[];
}

export default function SessionsPage(props: SessionsPageProps) {
  const sessions = Array.isArray(props?.sessions) ? props.sessions : [];
  return (
    <div>
      <script dangerouslySetInnerHTML={{ __html: `window.__SESSIONS__ = ${JSON.stringify(sessions).replace(/</g, "\\u003c")};` }} />
    </div>
  );
}

export async function loadData(): Promise<SessionsPageProps> {
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
  return { sessions };
}
