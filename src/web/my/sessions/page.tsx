import React from "react";
import { aiTool } from "../../../scripts/index";
import SessionsApp, { Session } from "./SessionsApp.client";

export interface SessionsPageProps {
  sessions: Session[];
}

export default function SessionsPage(props: SessionsPageProps) {
  const sessions = Array.isArray(props?.sessions) ? props.sessions : [];
  // Dehydrate the server-rendered sessions so the client component hydrates
  // with identical data (props do not cross the bundle boundary on their own).
  // Single data channel (Phase B): the consolidated __REACT_DATA__ slice only.
  const json = JSON.stringify(sessions).replace(/</g, "\\u003c");
  return (
    <SessionsApp
      initial={sessions}
      payloadHtml={`window.__REACT_DATA__ = { sessions: ${json} };`}
    />
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
