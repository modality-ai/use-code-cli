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
        <li><a href="/my/projects" className="text-accent-collaboration hover:underline"><code>GET /my/projects</code></a> - HTML list of all projects</li>
        <li><code>GET /my/session/:name</code> - live transcript viewer with auto-scroll and session state</li>
        <li><a href="/my/tunnel" className="text-accent-collaboration hover:underline"><code>GET /my/tunnel</code></a> - cloudflared tunnel launcher (URL + stream output)</li>
        <li><a href="/my/notifications" className="text-accent-collaboration hover:underline"><code>GET /my/notifications</code></a> - Web Push subscription management</li>
        <li><code>GET /my/project/:name</code> - project executor view</li>
        <li><a href="/design" className="text-accent-collaboration hover:underline"><code>GET /design</code></a> - rendered design system</li>
      </ul>
    </div>
  );
}
