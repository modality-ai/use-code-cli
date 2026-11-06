// Client-side enhancement for the sessions page (Next.js-like: server renders shell, this hydrates).
declare global {
  interface Window {
    __SESSIONS__?: any[];
  }
}

function cleanPrompt(text: string): string {
  return String(text || "")
    .replace(/<\/?cross-session-message[^>]*>/g, "")
    .replace(/<!-- use-code-cli:auto-reply[^>]*-->/g, "")
    .replace(/This came from another Claude session[\s\S]*$/g, "")
    .replace(/^Another Claude session sent a message:\n/, "")
    .trim();
}

const React: any = (window as any).React;
const ReactDOM: any = (window as any).ReactDOM;

function App() {
  const [sessions, setSessions] = React.useState(Array.isArray(window.__SESSIONS__) ? window.__SESSIONS__ : []);
  const [error, setError] = React.useState(null);
  const [lastUpdated, setLastUpdated] = React.useState(Date.now());
  React.useEffect(() => {
    let es: any = null;
    let retry: any = null;
    const connect = () => {
      es = new EventSource("/api/sessions/events");
      es.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data);
          if (Array.isArray(d.data)) setSessions(d.data);
          setLastUpdated(Date.now());
          setError(null);
        } catch (e) {
          setError(String(e));
        }
      };
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          if (retry) clearTimeout(retry);
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => {
      if (retry) clearTimeout(retry);
      if (es) es.close();
    };
  }, []);
  if (error) return React.createElement("p", { className: "text-text-primary" }, "Error: " + error);
  if (sessions.length === 0) return React.createElement("p", { className: "text-text-muted" }, "No active sessions.");
  return React.createElement(
    "div",
    null,
    React.createElement(
      "div",
      { className: "flex items-center gap-2 mb-md" },
      React.createElement("h1", { className: "text-2xl font-semibold font-display" }, "Sessions"),
      React.createElement("span", { className: "text-[12px] text-text-muted font-mono tabular-nums min-w-[150px] inline-block text-left" }, "Live · updated " + new Date(lastUpdated).toLocaleTimeString())
    ),
    sessions.map((s: any, i: number) =>
      React.createElement(
        "div",
        { className: "border border-border rounded-sm p-3 mb-sm bg-surface", key: i },
        React.createElement("a", { href: "/session/" + encodeURIComponent(s.name || s.sessionId || ""), className: "font-semibold text-accent-collaboration hover:underline" }, s.name || s.sessionId),
        React.createElement("div", { className: "font-code text-[13px] text-text-muted" }, (s.hero || "-") + " · " + (s.status || "-")),
        React.createElement("div", { className: "text-text-muted" }, s.cwd || "-"),
        React.createElement("div", null, cleanPrompt(s.lastPrompt || ""))
      )
    )
  );
}

const root = document.getElementById("root");
if (root && React && ReactDOM) {
  ReactDOM.createRoot(root).render(React.createElement(App));
}

export {};
