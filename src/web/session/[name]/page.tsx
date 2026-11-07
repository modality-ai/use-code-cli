import React from "react";

export interface SessionPageProps {
  name?: string;
}

export default function SessionPage(props: SessionPageProps) {
  const name = props?.name || "";
  return (
    <div>
      <div className="flex items-center gap-3 mb-md">
        <a href="/sessions" className="text-[12px] text-accent-collaboration hover:underline">← Back to sessions</a>
        <h1 className="text-2xl font-semibold font-display">{name || "Session"}</h1>
      </div>
      <div id="transcript" className="border border-border rounded-sm p-3 bg-surface font-code text-[13px] max-h-[70vh] overflow-auto">
        <p className="text-text-muted">Loading session transcript...</p>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="flex items-center gap-1 text-[12px] text-text-muted cursor-pointer">
          <input type="checkbox" id="autoscroll" defaultChecked />
          Auto-scroll to bottom
        </label>
        <button type="button" id="scroll-top" className="text-[12px] text-text-muted border border-border rounded-sm px-2 py-0.5 cursor-pointer">↑ Top</button>
        <button type="button" id="scroll-bottom" className="text-[12px] text-text-muted border border-border rounded-sm px-2 py-0.5 cursor-pointer">↓ Bottom</button>
        <span id="session-state" className="text-[12px] text-text-muted ml-auto">🔍 checking…</span>
      </div>
      <div className="chat-input" style={{ display: "none" }}>
        <input id="chat-input" type="text" placeholder="Send a message to this session..." />
        <button id="chat-send">Send</button>
      </div>
      <div id="chat-status" className="text-[12px] text-text-muted mt-1"></div>
      <script dangerouslySetInnerHTML={{ __html: `window.__SESSION_NAME__ = ${JSON.stringify(name)};` }} />
    </div>
  );
}

export async function loadData(props?: { params?: Record<string, string>; name?: string }): Promise<SessionPageProps> {
  const name = props?.name || props?.params?.name || "";
  return { name };
}
