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

function cleanPrompt(text: string): string {
  return String(text || "")
    .replace(/<\/?cross-session-message[^>]*>/g, "")
    .replace(/<!-- use-code-cli:auto-reply[^>]*-->/g, "")
    .replace(/This came from another Claude session[\s\S]*$/g, "")
    .replace(/^Another Claude session sent a message:\n/, "")
    .trim();
}

export default function SessionsPage({ sessions }: SessionsPageProps) {
  if (!sessions || sessions.length === 0) {
    return React.createElement("p", { className: "text-text-muted" }, "No active sessions.");
  }
  return React.createElement(
    "div",
    null,
    React.createElement("h1", { className: "text-2xl font-semibold mb-md font-display" }, "Sessions"),
    sessions.map((s, i) =>
      React.createElement(
        "div",
        { className: "border border-border rounded-sm p-3 mb-sm bg-surface", key: i },
        React.createElement("div", { className: "font-semibold text-accent-collaboration" }, s.name || s.sessionId),
        React.createElement("div", { className: "font-code text-[13px] text-text-muted" }, (s.hero || "-") + " · " + (s.status || "-")),
        React.createElement("div", { className: "text-text-muted" }, s.cwd || "-"),
        React.createElement("div", null, cleanPrompt(s.lastPrompt || ""))
      )
    )
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

export function clientScript(data: SessionsPageProps): string {
  const sessionsJson = JSON.stringify(data.sessions).replace(/</g, "\\u003c");
  return `<script>window.__SESSIONS__ = ${sessionsJson};</script>
<script>
function cleanPrompt(text) {
  return String(text || '')
    .replace(/<\\/?cross-session-message[^>]*>/g, '')
    .replace(/<!-- use-code-cli:auto-reply[^>]*-->/g, '')
    .replace(/This came from another Claude session[\\s\\S]*$/g, '')
    .replace(/^Another Claude session sent a message:\\\\n/, '')
    .trim();
}
function App() {
  const [sessions, setSessions] = React.useState(Array.isArray(window.__SESSIONS__) ? window.__SESSIONS__ : []);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/sessions');
        const d = await r.json();
        if (active && Array.isArray(d.data)) setSessions(d.data);
        setError(null);
      } catch (e) { if (active) setError(String(e)); }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { active = false; clearInterval(id); };
  }, []);
  if (error) return React.createElement('p', {className:'text-text-primary'}, 'Error: ' + error);
  if (sessions.length === 0) return React.createElement('p', {className:'text-text-muted'}, 'No active sessions.');
  return React.createElement('div', null,
    React.createElement('h1', {className:'text-2xl font-semibold mb-md font-display'}, 'Sessions'),
    sessions.map((s,i) => React.createElement('div', {className:'border border-border rounded-sm p-3 mb-sm bg-surface', key:i},
      React.createElement('div', {className:'font-semibold text-accent-collaboration'}, s.name || s.sessionId),
      React.createElement('div', {className:'font-code text-[13px] text-text-muted'}, (s.hero||'-') + ' · ' + (s.status||'-')),
      React.createElement('div', {className:'text-text-muted'}, s.cwd || '-'),
      React.createElement('div', null, cleanPrompt(s.lastPrompt || ''))
    ))
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script>`;
}