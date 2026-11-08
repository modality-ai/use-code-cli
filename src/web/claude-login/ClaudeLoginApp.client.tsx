"use client";

import React, { useEffect } from "react";
import { CLAUDE_STATUS, LOGIN_MODE, LOGIN_BTN, STATUS_BTN, CODE_BOX, CODE_INPUT, SEND_CODE_BTN, LOGIN_OUTPUT } from "./dom-ids";

export interface ClaudeLoginPageProps {
  status?: unknown;
}

export default function ClaudeLoginApp({ status }: ClaudeLoginPageProps = {}) {
  const summary = status
    ? Object.keys(status as Record<string, unknown>).map((k) => `${k}: ${JSON.stringify((status as Record<string, unknown>)[k])}`).join("\n")
    : "Status unavailable";

  useEffect(() => {
    let currentSessionId: string | null = null;
    function refreshStatus() {
      const el = document.getElementById(CLAUDE_STATUS);
      if (!el) return;
      fetch("/api/claude-login").then((r) => r.json()).then((d) => {
        if (d.success && d.data) {
          const s = d.data;
          el.textContent = Object.keys(s).map((k) => k + ": " + JSON.stringify(s[k])).join("\n");
        } else {
          el.textContent = "Status unavailable";
        }
      }).catch((e) => { el.textContent = "Status error: " + String(e); });
    }
    function appendOutput(text: string) {
      const el = document.getElementById(LOGIN_OUTPUT);
      if (el) { el.textContent += text; el.scrollTop = el.scrollHeight; }
    }
    function showInput(show: boolean) {
      const box = document.getElementById(CODE_BOX);
      if (box) box.style.display = show ? "flex" : "none";
    }
    async function startLogin() {
      const btn = document.getElementById(LOGIN_BTN) as HTMLButtonElement | null;
      const out = document.getElementById(LOGIN_OUTPUT);
      const sel = document.getElementById(LOGIN_MODE) as HTMLSelectElement | null;
      if (out) out.textContent = "";
      if (btn) btn.disabled = true;
      showInput(false);
      appendOutput("Starting login...\n");
      try {
        const mode = sel ? sel.value : "claudeai";
        const r = await fetch("/api/claude-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", mode }) });
        const d = await r.json();
        if (!d.success) { appendOutput("Failed to start: " + (d.error || "unknown") + "\n"); return; }
        if (!d.sessionId) { appendOutput("Failed to start: no session id returned\n"); return; }
        currentSessionId = d.sessionId;
        fetch("/api/claude-login?stream=" + encodeURIComponent(currentSessionId!))
          .then(async (res) => {
            if (!res.body) return;
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            while (true) {
              const x = await reader.read();
              if (x.done) break;
              if (x.value) appendOutput(dec.decode(x.value, { stream: true }));
            }
            showInput(false);
            appendOutput("\nDone. Refreshing status...\n");
            refreshStatus();
          })
          .catch((e) => appendOutput("\nStream error: " + String(e) + "\n"));
        setTimeout(() => showInput(true), 500);
      } catch (e) {
        appendOutput("\nError: " + String(e) + "\n");
      } finally {
        const b = document.getElementById(LOGIN_BTN) as HTMLButtonElement | null;
        if (b) b.disabled = false;
      }
    }
    async function sendCode() {
      const input = document.getElementById(CODE_INPUT) as HTMLInputElement | null;
      if (!input || !currentSessionId) return;
      const value = input.value.trim();
      if (!value) return;
      try {
        const r = await fetch("/api/claude-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "input", sessionId: currentSessionId, value }) });
        const d = await r.json();
        if (d.success) { appendOutput("\n[code sent]\n"); input.value = ""; }
        else { appendOutput("\nSend failed: " + (d.error || "unknown") + "\n"); }
      } catch (e) {
        appendOutput("\nSend error: " + String(e) + "\n");
      }
    }
    const loginBtn = document.getElementById(LOGIN_BTN);
    const statusBtn = document.getElementById(STATUS_BTN);
    const sendBtn = document.getElementById(SEND_CODE_BTN);
    if (loginBtn) loginBtn.addEventListener("click", startLogin);
    if (statusBtn) statusBtn.addEventListener("click", refreshStatus);
    if (sendBtn) sendBtn.addEventListener("click", sendCode);
    refreshStatus();
  }, []);

  return (
    <div className="max-w-3xl mx-auto my-6 p-4">
      <h1 className="text-2xl font-semibold font-display mb-md">Claude Code Login</h1>
      <p className="text-text-muted mb-md">Run the Claude Code CLI login flow on this server and write the resulting token back to Claude Code's config (~/.claude.json). Useful for remote servers where you can't run the CLI interactively.</p>
      <div className="border border-border rounded-sm p-3 mb-md bg-surface">
        <div className="font-semibold mb-xs">Current status</div>
        <pre id={CLAUDE_STATUS} className="font-code text-sm text-text-muted whitespace-pre-wrap">{summary}</pre>
      </div>
      <div className="border border-border rounded-sm p-3 mb-md bg-surface">
        <label className="block font-semibold mb-xs" htmlFor={LOGIN_MODE}>Account type</label>
        <select id={LOGIN_MODE} className="border border-border rounded-sm p-2 bg-surface text-text-primary w-full" defaultValue="claudeai">
          <option value="claudeai">Claude subscription (default)</option>
          <option value="console">Anthropic Console (API usage billing)</option>
        </select>
        <div className="flex gap-2 mt-md">
          <button id={LOGIN_BTN} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold">Start login</button>
          <button id={STATUS_BTN} className="px-3 py-2 rounded-sm border border-border">Refresh status</button>
        </div>
      </div>
      <div id={CODE_BOX} className="flex gap-2 mt-md" style={{ display: "none" }}>
        <input id={CODE_INPUT} className="flex-1 border border-border rounded-sm p-2 bg-surface text-text-primary font-code text-sm" placeholder="Paste the code from the browser here" />
        <button id={SEND_CODE_BTN} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold">Send code</button>
      </div>
      <div className="border border-border rounded-sm p-3 bg-surface mt-md">
        <div className="font-semibold mb-xs">Output</div>
        <pre id={LOGIN_OUTPUT} className="font-code text-xs whitespace-pre-wrap max-h-96 overflow-auto text-text-muted"></pre>
      </div>
    </div>
  );
}