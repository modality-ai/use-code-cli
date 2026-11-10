import React from "react";

export default function HelpPage() {
  return (
    <div>
      <h1>use-code-cli server</h1>
      <p>
        Start with <code>bun start</code> (or <code>bun src/runner/server.ts</code>).
      </p>
      <p>Port defaults to 3000; override with <code>PORT</code> env var.</p>
      <h2>Endpoints</h2>
      <ul>
        <li><a href="/my/sessions" className="text-accent-collaboration hover:underline"><code>GET /my/sessions</code></a> - HTML list of all sessions</li>
        <li><code>GET /my/session/:name</code> - live transcript viewer with auto-scroll and session state</li>
        <li><a href="/my/tunnel" className="text-accent-collaboration hover:underline"><code>GET /my/tunnel</code></a> - cloudflared tunnel launcher (URL + stream output)</li>
        <li><a href="/design" className="text-accent-collaboration hover:underline"><code>GET /design</code></a> - rendered design system</li>
        <li><a href="/help" className="text-accent-collaboration hover:underline"><code>GET /help</code></a> - this page</li>
      </ul>
      <h2>API</h2>
      <ul>
        <li><code>GET /my/api/session?name=</code> - transcript entries, online status, busy/idle state</li>
        <li><code>GET /my/api/tunnel</code> - cloudflared availability + current tunnel URL</li>
        <li><code>POST /my/api/tunnel</code> - start a cloudflared tunnel</li>
        <li><code>DELETE /my/api/tunnel</code> - stop the running tunnel</li>
      </ul>
      <h2>Example</h2>
      <pre>curl http://127.0.0.1:3000/my/sessions</pre>
    </div>
  );
}
