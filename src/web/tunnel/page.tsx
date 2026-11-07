import React from "react";
import { TUNNEL_BTN, TUNNEL_OUTPUT, TUNNEL_STATUS, TUNNEL_URL, UNLINK_BTN, COPY_BTN } from "./dom-ids";

export interface TunnelPageProps {
  url?: string | null;
}

export default function TunnelPage({ url }: TunnelPageProps = {}) {
  return (
    <div className="max-w-[720px] mx-auto my-6 p-4">
      <h1>Tunnel (cloudflared)</h1>
      <p>
        Cloudflare Tunnel client (formerly Argo Tunnel). Integrates the use-code-cli
        web server with Cloudflare so it can be reached from anywhere.
      </p>
      <p>
        Source:{" "}
        <a href="https://formulae.brew.sh/formula/cloudflared" className="text-accent-collaboration hover:underline">
          https://formulae.brew.sh/formula/cloudflared
        </a>
      </p>

      <h2>1. Install</h2>
      <p>Install cloudflared with Homebrew:</p>
      <pre className="bg-surface border border-border rounded-sm p-3 text-accent-collaboration font-bold">brew install cloudflared</pre>
      <p>Status: <span id={TUNNEL_STATUS}>checking…</span></p>

      <h2>2. Create tunnel &amp; link to this project web url</h2>
      <p>One click creates the tunnel and links it to this project web url.</p>
      <button id={TUNNEL_BTN} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold cursor-pointer">
        Create &amp; Link tunnel
      </button>

      <h2>Tunnel URL</h2>
      <div className="flex items-center gap-2">
        <div id={TUNNEL_URL} className="flex-1 border border-border rounded-sm p-3 bg-surface font-code text-[13px] break-all">
          {url || "—"}
        </div>
        <button id={COPY_BTN} disabled className="px-3 py-2 rounded-sm border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          Copy
        </button>
        <button id={UNLINK_BTN} disabled className="px-3 py-2 rounded-sm border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          Unlink
        </button>
      </div>

      <div className="border border-border rounded-sm p-3 bg-surface mt-md">
        <div className="font-semibold mb-xs">Output</div>
        <pre id={TUNNEL_OUTPUT} className="font-code text-[12px] whitespace-pre-wrap max-h-[400px] overflow-auto text-text-muted"></pre>
      </div>
    </div>
  );
}

export async function loadData(): Promise<TunnelPageProps> {
  // Don't trust persisted URL across restarts; client verifies liveness via API.
  return { url: null };
}
