"use client";

// Client-side enhancement for the session page.
// Server renders the initial transcript; this module handles live SSE updates + chat.
declare global {
  interface Window {
    __SESSION_NAME__: string;
    __INITIAL_ENTRIES__: any[];
    __TRANSCRIPT_PATH__: string;
  }
}

const name =
  (typeof window !== "undefined" && (window.__SESSION_NAME__ ||
    new URLSearchParams(location.search).get("name") ||
    decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || ""))) ||
  "";

function esc(s: any): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cls(e: any): string {
  return e.role === "user" ? "text-accent-collaboration" : "text-text-primary";
}

function label(e: any): string {
  return (e.role === "user" ? "❯ " : "⏺ ") + (e.role === "user" ? "You" : "Claude");
}

function tryPrettyJson(text: any): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.stringify(JSON.parse(text.trim()), null, 2);
  } catch {}
  const lines = text.split(/\n/);
  let parsedAny = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      parsedAny = true;
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return line;
    }
  });
  if (!parsedAny) return null;
  return out.join("\n");
}

function renderEntry(e: any): string {
  const tools = Array.isArray(e.tools)
    ? e.tools
        .map((t: any, ti: number) => {
          const pretty = tryPrettyJson(t.result);
          const resultHtml = pretty
            ? '<pre class="json whitespace-pre-wrap text-[12px] mt-1">' + esc(pretty) + "</pre>"
            : t.resultHtml
            ? '<div class="mt-1 md-content max-w-none">' + t.resultHtml + "</div>"
            : "";
          return (
            '<details class="pl-4 mt-1 border border-border rounded-sm p-2">' +
            "<summary>CLICK TO SEE " +
            esc(t.name || "tool") +
            "</summary>" +
            '<pre class="whitespace-pre-wrap text-[12px] mt-1">' +
            esc(t.input != null ? JSON.stringify(t.input, null, 2) : "") +
            "</pre>" +
            resultHtml +
            "</details>"
          );
        })
        .join("")
    : "";
  return (
    '<div class="mb-sm">' +
    '<div class="' +
    cls(e) +
    ' font-semibold">' +
    esc(label(e)) +
    "</div>" +
    (e.html
      ? '<div class="pl-4 md-content max-w-none">' + e.html + "</div>"
      : e.text
      ? '<div class="pl-4 whitespace-pre-wrap">' + esc(e.text) + "</div>"
      : "") +
    tools +
    "</div>"
  );
}

function renderEntries(entries: any[]): void {
  const el = document.getElementById("transcript");
  if (!el) return;
  el.innerHTML = (Array.isArray(entries) ? entries : []).map(renderEntry).join("");
  const sc = document.getElementById("autoscroll") as HTMLInputElement | null;
  if (sc && sc.checked) el.scrollTop = el.scrollHeight;
}

// initial paint: fetch transcript from API (server renders shell only)
async function init() {
  try {
    const r = await fetch("/api/session?name=" + encodeURIComponent(name));
    const d = await r.json();
    if (d.success && Array.isArray(d.data?.entries)) renderEntries(d.data.entries);
    const online = d.success ? (d.data?.online !== false) : false;
    const chatInput = document.querySelector(".chat-input") as HTMLElement | null;
    if (chatInput) chatInput.style.display = online ? "flex" : "none";
  } catch {}
}
init();


// live updates via SSE
let es: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
function connect(): void {
  es = new EventSource("/api/session/events?name=" + encodeURIComponent(name));
  es.onmessage = (ev: MessageEvent) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.error) {
        const s = document.getElementById("chat-status");
        if (s) s.textContent = "Error: " + d.error;
      } else if (Array.isArray(d.entries)) {
        renderEntries(d.entries);
      }
    } catch {}
  };
  es.onerror = () => {
    if (es && es.readyState === EventSource.CLOSED) {
      es.close();
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 3000);
    }
  };
}
if (name) connect();

// chat
const input = document.getElementById("chat-input") as HTMLInputElement | null;
const btn = document.getElementById("chat-send") as HTMLButtonElement | null;
const status = document.getElementById("chat-status");
async function send(): Promise<void> {
  if (!input || !input.value.trim()) return;
  if (btn) btn.disabled = true;
  if (status) status.textContent = "sending...";
  try {
    const r = await fetch("/api/talk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message: input.value }),
    });
    const d = await r.json();
    if (d.success) {
      if (status) status.textContent = "sent";
      input.value = "";
    } else if (status) {
      status.textContent = "error: " + (d.error || "failed");
    }
  } catch (e) {
    if (status) status.textContent = "error: " + String(e);
  }
  if (btn) btn.disabled = false;
}
if (btn) btn.addEventListener("click", send);
if (input) input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") send();
});

const scrollTopBtn = document.getElementById("scroll-top");
const scrollBottomBtn = document.getElementById("scroll-bottom");
if (scrollTopBtn) scrollTopBtn.addEventListener("click", () => {
  const el = document.getElementById("transcript");
  if (el) el.scrollTop = 0;
});
if (scrollBottomBtn) scrollBottomBtn.addEventListener("click", () => {
  const el = document.getElementById("transcript");
  if (el) el.scrollTop = el.scrollHeight;
});

export {};
