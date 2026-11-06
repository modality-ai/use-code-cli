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
        <li><code>GET /sessions</code> - HTML list of all sessions</li>
        <li><code>GET /design</code> - rendered design system</li>
        <li><code>GET /help</code> - this page</li>
      </ul>
      <h2>Example</h2>
      <pre>curl http://127.0.0.1:3000/sessions</pre>
    </div>
  );
}
