"use client";

import React, { useEffect } from "react";
import { TUNNEL_BTN, TUNNEL_OUTPUT, TUNNEL_STATUS, TUNNEL_URL, UNLINK_BTN, COPY_BTN } from "./dom-ids";

export interface TunnelPageProps {
  url?: string | null;
}

export default function TunnelApp({ url }: TunnelPageProps = {}) {
  useEffect(() => {
    function updateActionButtons(hasUrl: boolean) {
      const copyBtn = document.getElementById(COPY_BTN) as HTMLButtonElement | null;
      const unlinkBtn = document.getElementById(UNLINK_BTN) as HTMLButtonElement | null;
      if (copyBtn) copyBtn.disabled = !hasUrl;
      if (unlinkBtn) unlinkBtn.disabled = !hasUrl;
    }
    function setUrlSection(u: string | null) {
      const el = document.getElementById(TUNNEL_URL);
      if (el) el.textContent = u || "—";
      updateActionButtons(!!u);
    }
    function appendOutput(text: string) {
      const el = document.getElementById(TUNNEL_OUTPUT);
      if (el) { el.textContent += text; el.scrollTop = el.scrollHeight; }
    }
    async function createAndLink() {
      const btn = document.getElementById(TUNNEL_BTN) as HTMLButtonElement | null;
      const out = document.getElementById(TUNNEL_OUTPUT);
      if (out) out.textContent = "";
      if (btn) btn.disabled = true;
      appendOutput("Starting cloudflared tunnel...\n");
      try {
        const r = await fetch("/api/tunnel", { method: "POST" });
        const d = await r.json();
        if (!d.success || !d.sessionId) { appendOutput("Failed to start: " + (d.error || "unknown") + "\n"); return; }
        if (d.url) setUrlSection(d.url);
        fetch("/api/tunnel?stream=" + encodeURIComponent(d.sessionId))
          .then(async (res) => {
            if (!res.body) return;
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            while (true) {
              const x = await reader.read();
              if (x.done) break;
              if (x.value) {
                const chunk = dec.decode(x.value, { stream: true });
                appendOutput(chunk);
                const m = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
                if (m) setUrlSection(m[0]);
              }
            }
          })
          .catch((e) => appendOutput("\nStream error: " + String(e) + "\n"));
      } catch (e) {
        appendOutput("\nError: " + String(e) + "\n");
      } finally {
        const b = document.getElementById(TUNNEL_BTN) as HTMLButtonElement | null;
        if (b) b.disabled = false;
      }
    }
    async function unlink() {
      const btn = document.getElementById(UNLINK_BTN) as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      try {
        await fetch("/api/tunnel", { method: "DELETE" });
        setUrlSection(null);
        const out = document.getElementById(TUNNEL_OUTPUT);
        if (out) out.textContent = "";
        appendOutput("Unlinked.\n");
      } catch (e) {
        appendOutput("\nUnlink error: " + String(e) + "\n");
      } finally {
        const b = document.getElementById(UNLINK_BTN) as HTMLButtonElement | null;
        if (b) b.disabled = false;
      }
    }
    const btn = document.getElementById(TUNNEL_BTN);
    if (btn) btn.addEventListener("click", createAndLink);
    const unlinkBtn = document.getElementById(UNLINK_BTN);
    if (unlinkBtn) unlinkBtn.addEventListener("click", unlink);
    const copyBtn = document.getElementById(COPY_BTN);
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const urlEl = document.getElementById(TUNNEL_URL);
        const text = urlEl?.textContent?.trim() || "";
        if (!text || text === "—") return;
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch {}
          document.body.removeChild(ta);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
        }
      });
    }
    const statusEl = document.getElementById(TUNNEL_STATUS);
    function refreshTunnelStatus() {
      fetch("/api/tunnel")
        .then((r) => r.json())
        .then((d) => {
          if (statusEl) statusEl.textContent = d.success ? "cloudflared: " + (d.version || "ready") : "cloudflared not found — install first";
          if (d.url) setUrlSection(d.url);
          else updateActionButtons(false);
        })
        .catch((e) => { if (statusEl) statusEl.textContent = "status error: " + String(e); });
    }
    refreshTunnelStatus();
    const intervalId = setInterval(refreshTunnelStatus, 2000);
    if (url) setUrlSection(url);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="max-w-[720px] mx-auto my-6 p-4">
      <h1>Tunnel (cloudflared)</h1>
      <p>Cloudflare Tunnel client (formerly Argo Tunnel). Integrates the use-code-cli web server with Cloudflare so it can be reached from anywhere.</p>
      <p>Source: <a href="https://formulae.brew.sh/formula/cloudflared" className="text-accent-collaboration hover:underline">https://formulae.brew.sh/formula/cloudflared</a></p>
      <h2>1. Install</h2>
      <p>Install cloudflared with Homebrew:</p>
      <pre className="bg-surface border border-border rounded-sm p-3 text-accent-collaboration font-bold">brew install cloudflared</pre>
      <p>Status: <span id={TUNNEL_STATUS}>checking…</span></p>
      <h2>2. Create tunnel &amp; link to this project web url</h2>
      <p>One click creates the tunnel and links it to this project web url.</p>
      <button id={TUNNEL_BTN} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold cursor-pointer">Create &amp; Link tunnel</button>
      <h2>Tunnel URL</h2>
      <div className="flex items-center gap-2">
        <div id={TUNNEL_URL} className="flex-1 border border-border rounded-sm p-3 bg-surface font-code text-[13px] break-all">{url || "—"}</div>
        <button id={COPY_BTN} disabled className="px-3 py-2 rounded-sm border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Copy</button>
        <button id={UNLINK_BTN} disabled className="px-3 py-2 rounded-sm border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Unlink</button>
      </div>
      <div className="border border-border rounded-sm p-3 bg-surface mt-md">
        <div className="font-semibold mb-xs">Output</div>
        <pre id={TUNNEL_OUTPUT} className="font-code text-[12px] whitespace-pre-wrap max-h-[400px] overflow-auto text-text-muted"></pre>
      </div>
    </div>
  );
}