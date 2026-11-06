import { CLAUDE_STATUS, LOGIN_MODE, LOGIN_BTN, STATUS_BTN, CODE_BOX, CODE_INPUT, SEND_CODE_BTN, LOGIN_OUTPUT } from "./dom-ids";
let currentSessionId: string | null = null;
function refreshStatus() {
  const el = document.getElementById(CLAUDE_STATUS);
  if (!el) return;
  fetch("/api/claude-login")
    .then((r) => r.json())
    .then((d) => {
      if (d.success && d.data) {
        const s = d.data;
        el.textContent = Object.keys(s)
          .map((k) => k + ": " + JSON.stringify(s[k]))
          .join("\n");
      } else {
        el.textContent = "Status unavailable";
      }
    })
    .catch((e) => { el.textContent = "Status error: " + String(e); });
}

function appendOutput(text: string) {
  const el = document.getElementById(LOGIN_OUTPUT);
  if (el) {
    el.textContent += text;
    el.scrollTop = el.scrollHeight;
  }
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
    const r = await fetch("/api/claude-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", mode }),
    });
    const d = await r.json();
    if (!d.success) {
      appendOutput("Failed to start: " + (d.error || "unknown") + "\n");
      return;
    }
    if (!d.sessionId) {
      appendOutput("Failed to start: no session id returned\n");
      return;
    }
    currentSessionId = d.sessionId;
    // Use fetch streaming for plain text response
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
    if (btn) btn.disabled = false;
  }
}

async function sendCode() {
  const input = document.getElementById(CODE_INPUT) as HTMLInputElement | null;
  if (!input || !currentSessionId) return;
  const value = input.value.trim();
  if (!value) return;
  try {
    const r = await fetch("/api/claude-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "input", sessionId: currentSessionId, value }),
    });
    const d = await r.json();
    if (d.success) {
      appendOutput("\n[code sent]\n");
      input.value = "";
    } else {
      appendOutput("\nSend failed: " + (d.error || "unknown") + "\n");
    }
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

export {};
