import { TUNNEL_BTN, TUNNEL_OUTPUT, TUNNEL_STATUS, TUNNEL_URL, UNLINK_BTN, COPY_BTN } from "./dom-ids";

function setUrlSection(url: string | null) {
  const el = document.getElementById(TUNNEL_URL);
  if (el) el.textContent = url || "—";
  updateActionButtons(!!url);
}

function updateActionButtons(hasUrl: boolean) {
  const copyBtn = document.getElementById(COPY_BTN) as HTMLButtonElement | null;
  const unlinkBtn = document.getElementById(UNLINK_BTN) as HTMLButtonElement | null;
  if (copyBtn) copyBtn.disabled = !hasUrl;
  if (unlinkBtn) unlinkBtn.disabled = !hasUrl;
}

function appendOutput(text: string) {
  const el = document.getElementById(TUNNEL_OUTPUT);
  if (el) {
    el.textContent += text;
    el.scrollTop = el.scrollHeight;
  }
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
    if (!d.success || !d.sessionId) {
      appendOutput("Failed to start: " + (d.error || "unknown") + "\n");
      return;
    }
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
    if (btn) btn.disabled = false;
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
    if (btn) btn.disabled = false;
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
      // fallback
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
setInterval(refreshTunnelStatus, 2000);

export {};
