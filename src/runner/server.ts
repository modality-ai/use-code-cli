import http from "node:http";
import { readFileSync } from "node:fs";
import { aiTool } from "../scripts/index";

export interface StartOptions {
  port?: number;
  host?: string;
  includeOffline?: boolean;
}

export function start(options: StartOptions = {}): http.Server {
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? "127.0.0.1";
  const includeOffline = options.includeOffline ?? true;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (url === "/") {
        res.writeHead(302, { Location: "/help" });
        res.end();
        return;
      }
      if (url === "/sessions") {
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
        const sessionsJson = JSON.stringify(sessions).replace(/</g, "\\u003c");
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sessions</title>
<style>
:root { --paper:#fbf7ef; --surface:#fffdf8; --border:#d8d4cb; --text-primary:#23262b; --text-muted:#5b5f66; --accent:#1f6f78; }
@media (prefers-color-scheme: dark) { :root { --paper:#1a1b1e; --surface:#22252a; --border:#3a3e44; --text-primary:#e8e6e1; --text-muted:#a6a9ae; --accent:#4dacb2; } }
body { margin:0; }
</style>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        text: { primary: 'var(--text-primary)', muted: 'var(--text-muted)' },
        accent: { collaboration: 'var(--accent)' }
      },
      fontFamily: {
        display: ['"Noto Sans TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'sans-serif'],
        body: ['"Noto Sans TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'sans-serif'],
        code: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      borderRadius: { sm: '4px', md: '12px', lg: '16px' },
      spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', section: '64px', 'island-gap': '24px', 'plate-offset': '8px' }
    }
  }
};
</script>
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
</head><body class="bg-paper text-text-primary font-body"><div id="root" class="max-w-[960px] mx-auto my-lg p-md"></div>
<script>window.__SESSIONS__ = ${sessionsJson};</script>
<script>
function cleanPrompt(text) {
  return String(text || '')
    .replace(/<\\/?cross-session-message[^>]*>/g, '')
    .replace(/<!-- use-code-cli:auto-reply[^>]*-->/g, '')
    .replace(/This came from another Claude session[\s\S]*$/g, '')
    .replace(/^Another Claude session sent a message:\\n/, '')
    .trim();
}
function App() {
  const [sessions, setSessions] = React.useState(Array.isArray(window.__SESSIONS__) ? window.__SESSIONS__ : []);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  if (loading) return React.createElement('p', {className:'text-text-muted'}, 'Loading...');
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
</script>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (url === "/design") {
        let rendered = "";
        try {
          const md = readFileSync(new URL("../../design.md", import.meta.url), "utf8");
          rendered = Bun.markdown.html(md);
        } catch (err) {
          rendered = `<p>Error reading design.md: ${String(err)}</p>`;
        }
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Design System — Island</title>
<style>
:root { --paper:#fbf7ef; --surface:#fffdf8; --border:#d8d4cb; --text-primary:#23262b; --text-muted:#5b5f66; --accent:#1f6f78; }
@media (prefers-color-scheme: dark) { :root { --paper:#1a1b1e; --surface:#22252a; --border:#3a3e44; --text-primary:#e8e6e1; --text-muted:#a6a9ae; --accent:#4dacb2; } }
body { margin:0; font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif; background:var(--paper); color:var(--text-primary); }
.container { max-width:960px; margin:24px auto; padding:16px; }
article { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; }
article h1, article h2, article h3 { color:var(--text-primary); }
article h1 { font-size:28px; margin:0 0 16px; }
article h2 { font-size:22px; margin:24px 0 12px; }
article h3 { font-size:18px; margin:16px 0 8px; }
article p, article li { line-height:1.6; }
article code { font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,monospace; font-size:13px; background:var(--paper); padding:2px 4px; border-radius:4px; }
article pre { background:var(--paper); border:1px solid var(--border); border-radius:12px; padding:16px; overflow:auto; }
article table { width:100%; border-collapse:collapse; margin:12px 0; }
article th, article td { border:1px solid var(--border); padding:8px; text-align:left; }
article th { background:var(--paper); }
article a { color:var(--accent); }
.muted { color:var(--text-muted); }
</style>
<script src="https://cdn.tailwindcss.com"></script>
</head><body><div class="container"><article>${rendered}</article></div></body></html>`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (url === "/help") {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>use-code-cli server</title></head><body>
<h1>use-code-cli server</h1>
<p>Start with <code>bun start</code> (or <code>bun src/runner/server.ts</code>).</p>
<p>Port defaults to 3000; override with <code>PORT</code> env var.</p>
<h2>Endpoints</h2>
<ul>
<li><code>GET /sessions</code> - HTML list of all sessions</li>
<li><code>GET /design</code> - rendered design system</li>
<li><code>GET /help</code> - this page</li>
</ul>
<h2>Example</h2>
<pre>curl http://127.0.0.1:3000/sessions</pre>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "not found" }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
  });

  server.listen(port, host, () => {
    console.log(`use-code-cli server listening on http://${host}:${port}`);
  });
  return server;
}

if (require.main === module) {
  start();
}