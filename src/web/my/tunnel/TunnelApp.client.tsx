"use client";

import React, { useEffect, useRef, useState } from "react";
import { TUNNEL_BTN, TUNNEL_OUTPUT, TUNNEL_STATUS, TUNNEL_URL, TUNNEL_WARNING, UNLINK_BTN, COPY_BTN } from "./dom-ids";

export interface TunnelPageProps {
  url?: string | null;
  pollMs?: number;
}

export default function TunnelApp({ url, pollMs = 2000 }: TunnelPageProps = {}) {
  const [hasUrl, setHasUrl] = useState<boolean>(!!url);
  const [lastAliveAt, setLastAliveAt] = useState<string | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function updateActionButtons(u: boolean) {
    setHasUrl(u);
    const createBtn = document.getElementById(TUNNEL_BTN) as HTMLButtonElement | null;
    const copyBtn = document.getElementById(COPY_BTN) as HTMLButtonElement | null;
    const unlinkBtn = document.getElementById(UNLINK_BTN) as HTMLButtonElement | null;
    if (createBtn) createBtn.disabled = u;
    if (copyBtn) copyBtn.disabled = !u;
    if (unlinkBtn) unlinkBtn.disabled = !u;
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
      const r = await fetch("/my/api/tunnel", { method: "POST" });
      const d = await r.json();
      if (!d.success || !d.sessionId) { appendOutput("Failed to start: " + (d.error || "unknown") + "\n"); return; }
      if (d.url) setUrlSection(d.url);
      fetch("/my/api/tunnel?stream=" + encodeURIComponent(d.sessionId))
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
      const currentUrl = document.getElementById(TUNNEL_URL)?.textContent?.trim();
      if (b) b.disabled = !!currentUrl && currentUrl !== "—";
    }
  }
  async function unlink() {
    const btn = document.getElementById(UNLINK_BTN) as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      await fetch("/my/api/tunnel", { method: "DELETE" });
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
  async function copy() {
    const copyBtn = document.getElementById(COPY_BTN) as HTMLButtonElement | null;
    const urlEl = document.getElementById(TUNNEL_URL);
    const text = urlEl?.textContent?.trim() || "";
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      if (copyBtn) copyBtn.textContent = "Copied!";
      setTimeout(() => { if (copyBtn) copyBtn.textContent = "Copy"; }, 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
      if (copyBtn) copyBtn.textContent = "Copied!";
      setTimeout(() => { if (copyBtn) copyBtn.textContent = "Copy"; }, 1500);
    }
  }

  useEffect(() => {
    const statusEl = document.getElementById(TUNNEL_STATUS);
    function refreshTunnelStatus() {
      fetch("/my/api/tunnel")
        .then(async (r) => {
          const d = await r.json();
          // A 401 is an auth problem, not a cloudflared one: show the real
          // state, then send the tab to the sign-in page instead of leaving a
          // broken-looking tunnel form. The ref guard keeps repeated 401
          // polls from stacking redirect timers.
          if (r.status === 401) {
            if (statusEl) statusEl.textContent = "Not signed in — redirecting to sign in…";
            if (!redirectTimer.current) {
              // Give the user a moment to read the message (same pacing as
              // the passkey sign-in redirect).
              redirectTimer.current = setTimeout(() => { window.location.href = "/passkey"; }, 1500);
            }
            setUrlSection(null);
            setLastAliveAt(null);
            return;
          }
          // The session recovered inside the redirect window: cancel the
          // pending 401 navigation so a recovered user is not sent to sign in.
          if (redirectTimer.current) {
            clearTimeout(redirectTimer.current);
            redirectTimer.current = undefined;
          }
          if (statusEl) statusEl.textContent = d.success ? "cloudflared: " + (d.version || "ready") : "cloudflared not found — install first";
          if (d.url) setUrlSection(d.url);
          else setUrlSection(null);
          if (typeof d.lastAliveAt === "string") setLastAliveAt(d.lastAliveAt);
          else setLastAliveAt(null);
        })
        .catch((e) => { if (statusEl) statusEl.textContent = "status error: " + String(e); });
    }
    refreshTunnelStatus();
    const intervalId = setInterval(refreshTunnelStatus, pollMs);
    if (url) setUrlSection(url);
    return () => {
      clearInterval(intervalId);
      clearTimeout(redirectTimer.current);
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto my-6 p-4">
      <div className="flex items-center gap-2 mb-md">
        <a href="/" className="text-xs text-accent-collaboration hover:underline">Home</a>
        <span className="text-text-muted">/</span>
        <h1 className="text-2xl font-semibold font-display">Tunnel (cloudflared)</h1>
      </div>
      <p>Cloudflare Tunnel client (formerly Argo Tunnel). Integrates the use-code-cli web server with Cloudflare so it can be reached from anywhere.</p>
      <p>Source: <a href="https://formulae.brew.sh/formula/cloudflared" className="text-accent-collaboration hover:underline">https://formulae.brew.sh/formula/cloudflared</a></p>
      <h2>1. Install</h2>
      <p>Install cloudflared with Homebrew:</p>
      <pre className="bg-surface border border-border rounded-sm p-3 text-accent-collaboration font-bold">brew install cloudflared</pre>
      <p>Status: <span id={TUNNEL_STATUS}>checking…</span></p>
      <h2>2. Create tunnel &amp; link to this project web url</h2>
      <p>One click creates the tunnel and links it to this project web url.</p>
      {!hasUrl && <p id={TUNNEL_WARNING} className="text-xs text-text-muted mb-1">Creating a new tunnel changes the URL — Quick Tunnel cannot keep the current hostname.</p>}
      <button id={TUNNEL_BTN} onClick={createAndLink} disabled={hasUrl} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Create &amp; Link tunnel</button>
      <h2>Tunnel URL</h2>
      <p className="text-xs text-text-muted mb-1">Last alive: <span id="tunnel-last-alive">{lastAliveAt || "—"}</span></p>
      <div className="flex items-center gap-2">
        <div id={TUNNEL_URL} className="flex-1 border border-border rounded-sm p-3 bg-surface font-code text-sm break-all">{url || "—"}</div>
        <button id={COPY_BTN} onClick={copy} disabled={!hasUrl} className="px-3 py-2 rounded-sm border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Copy</button>
        <button id={UNLINK_BTN} onClick={unlink} disabled={!hasUrl} className="px-3 py-2 rounded-sm border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Unlink</button>
      </div>
      <div className="border border-border rounded-sm p-3 bg-surface mt-md">
        <div className="font-semibold mb-xs">Output</div>
        <pre id={TUNNEL_OUTPUT} className="font-code text-xs whitespace-pre-wrap max-h-96 overflow-auto text-text-muted"></pre>
      </div>
    </div>
  );
}


