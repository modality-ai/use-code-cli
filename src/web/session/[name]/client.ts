"use client";

import { onlineEmoji, sessionDispatch, sessionStore, statusEmoji } from "./store";

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

// Keep the session-state indicator in sync with the global store.
sessionStore.addListener((state: any) => {
  const el = document.getElementById("session-state");
  if (el) {
    el.textContent = `${statusEmoji(state.status)} ${state.status} · ${onlineEmoji(state.online)} ${state.online ? "active" : "offline"}`;
  }
  return state;
});

function esc(s: any): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cls(e: any): string {
  if (e.role === "user") return "text-accent-collaboration";
  if (e.role === "system") return "text-text-muted italic";
  return "text-text-primary";
}

function label(e: any): string {
  if (e.role === "user") return "❯ You";
  if (e.role === "system") return "📋 Recap";
  return "⏺ Claude";
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

/** Plain-text preview of an entry's message for the pinned one-line row. */
function teaserOf(e: any): string {
  const source = e.text != null ? String(e.text) : decodeHtmlText(e.html || "");
  const flat = source.replace(/\s+/g, " ").trim();
  return flat ? esc(flat.slice(0, 200)) : "";
}

function decodeHtmlText(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent || "";
}

function renderEntry(e: any): string {
  const tools = Array.isArray(e.tools)
    ? e.tools
        .map((t: any) => {
          const pretty = tryPrettyJson(t.result);
          // Fold bodies stay in a data attribute until the fold is opened:
          // text nodes that were never laid out can't make the page collapse
          // (a 50k-px open <pre> can freeze the tab outright).
          const resultHtml = t.resultHtml
            ? t.resultHtml
            : pretty
            ? '<pre class="json whitespace-pre-wrap text-[12px] mt-1">' + esc(pretty) + "</pre>"
            : t.result
            ? '<pre class="whitespace-pre-wrap text-[12px] mt-1">' + esc(t.result) + "</pre>"
            : "";
          const lazyBody = resultHtml
            ? '<div class="lazy-body" data-body="' + esc(resultHtml) + '"></div>'
            : "";
          return (
            '<details class="pl-4 mt-1 border border-border rounded-sm p-2">' +
            "<summary>CLICK TO SEE " +
            esc(t.name || "tool") +
            "</summary>" +
            '<pre class="whitespace-pre-wrap text-[12px] mt-1">' +
            esc(t.input != null ? JSON.stringify(t.input, null, 2) : "") +
            "</pre>" +
            lazyBody +
            "</details>"
          );
        })
        .join("")
    : "";
  const sticky = e.role === "user" ? " sticky top-0 bg-surface" : "";
  const labelRow = sticky
    ? '<div class="' +
      cls(e) +
      " relative font-semibold cursor-pointer flex items-baseline gap-2 leading-5" +
      '">' +
      '<span class="shrink-0">' +
      esc(label(e)) +
      "</span>" +
      '<span class="teaser flex-1 min-w-0 truncate font-normal text-text-muted">' +
      teaserOf(e) +
      "</span>" +
      "</div>"
    : '<div class="' + cls(e) + ' font-semibold">' + esc(label(e)) + "</div>";
  return (
    '<div class="mb-sm' +
    sticky +
    '">' +
    labelRow +
    (e.html
      ? '<div class="entry-body pl-4 md-content max-w-none">' + e.html + "</div>"
      : e.text
      ? '<div class="entry-body pl-4 whitespace-pre-wrap">' + esc(e.text) + "</div>"
      : "") +
    tools +
    "</div>"
  );
}

/**
 * Pinned (sticky) entries collapse to a one-line label: an entry whose top has
 * reached the scroll container's padding edge is stuck, so mark it. Pinned
 * elements rest at the scrollport top inset by the container's border+padding,
 * so the threshold must match that offset, not just the 1px border.
 */
function updateStuck(root: HTMLElement): void {
  const cs = getComputedStyle(root);
  const inset =
    (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) + 1;
  const rootTop = root.getBoundingClientRect().top;
  const stickyEls = root.querySelectorAll<HTMLElement>(".sticky.top-0");
  for (const wrapper of stickyEls) {
    wrapper.classList.toggle("stuck", wrapper.getBoundingClientRect().top <= rootTop + inset);
  }
}

/**
 * Clicking the pinned band toggles its fold, like <details>/<summary>.
 * The expanded body overlays below the band, so clicks inside it resolve to a
 * non-first child and won't collapse the entry.
 */
function bindStickyToggle(root: HTMLElement): void {
  const bound = root as HTMLElement & { __stickyToggleBound?: boolean };
  if (bound.__stickyToggleBound) return;
  bound.__stickyToggleBound = true;
  root.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    const child = target?.closest(".sticky.top-0 > div");
    const wrapper = child?.parentElement;
    if (!child || !wrapper || wrapper.firstElementChild !== child) return;
    wrapper.classList.toggle("open");
  });
}

/** Materialize a fold's pending body the first time it opens. */
function hydrateFold(d: HTMLDetailsElement): void {
  const body = d.querySelector<HTMLElement>(".lazy-body");
  if (!body || body.dataset.hydrated) return;
  body.innerHTML = body.dataset.body || "";
  delete body.dataset.body;
  body.dataset.hydrated = "yes";
}

function renderEntries(entries: any[]): void {
  const el = document.getElementById("transcript");
  if (!el) return;
  el.innerHTML = (Array.isArray(entries) ? entries : []).map(renderEntry).join("");
  updateStuck(el);
  bindStickyToggle(el);
  const holder = el as HTMLElement & { __scrollBound?: boolean };
  if (!holder.__scrollBound) {
    holder.__scrollBound = true;
    el.addEventListener("scroll", () => updateStuck(el), { passive: true });
  }
  // toggle doesn't bubble, so bind each fold directly; listeners die with
  // their nodes on the next rebuild.
  for (const d of el.querySelectorAll<HTMLDetailsElement>("details")) {
    d.addEventListener("toggle", () => hydrateFold(d));
  }
  const sc = document.getElementById("autoscroll") as HTMLInputElement | null;
  if (sc && sc.checked) el.scrollTop = el.scrollHeight;
}

/**
 * With "Auto-scroll to bottom" unchecked the page is frozen: no re-render, no
 * status churn — DOM stays put while the user reads history.
 */
function liveUpdates(): boolean {
  const sc = document.getElementById("autoscroll") as HTMLInputElement | null;
  return !sc || sc.checked;
}

// initial paint: fetch transcript from API (server renders shell only)
function applySessionState(d: any) {
  const online = d.success ? (d.data?.online !== false) : false;
  const status = (d.data?.status as string | null) || "idle";
  const chatInput = document.querySelector(".chat-input") as HTMLElement | null;
  if (chatInput) chatInput.style.display = online ? "flex" : "none";
  if (d.success) {
    sessionDispatch({ name, online, status });
  } else {
    const stateEl = document.getElementById("session-state");
    if (stateEl) stateEl.textContent = "⚠️ unavailable";
  }
}

async function refreshState() {
  if (!liveUpdates()) return;
  try {
    const r = await fetch("/api/session?name=" + encodeURIComponent(name));
    const d = await r.json();
    applySessionState(d);
  } catch {}
}

/** Full catch-up: reload entries + state (initial paint, and on re-enabling). */
async function reloadSession(): Promise<void> {
  if (!liveUpdates()) return;
  try {
    const r = await fetch("/api/session?name=" + encodeURIComponent(name));
    const d = await r.json();
    if (d.success && Array.isArray(d.data?.entries)) renderEntries(d.data.entries);
    // Reuse the same response instead of a second fetch.
    applySessionState(d);
  } catch {}
}
reloadSession();
// Poll session status so busy/idle transitions show up promptly.
setInterval(refreshState, 500);

// Resuming updates is instant: one catch-up reload instead of waiting for SSE.
document
  .getElementById("autoscroll")
  ?.addEventListener("change", () => {
    if (liveUpdates()) reloadSession();
  });


// live updates via SSE
let es: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
function connect(): void {
  es = new EventSource("/api/session/events?name=" + encodeURIComponent(name));
  es.onmessage = (ev: MessageEvent) => {
    if (!liveUpdates()) return;
    try {
      const d = JSON.parse(ev.data);
      if (d.error) {
        const s = document.getElementById("chat-status");
        if (s) s.textContent = "Error: " + d.error;
      } else if (Array.isArray(d.entries)) {
        renderEntries(d.entries);
        refreshState();
      }
    } catch {}
  };
  es.onerror = () => {
    if (liveUpdates()) {
      const stateEl = document.getElementById("session-state");
      if (stateEl) stateEl.textContent = "🔄 reconnecting…";
    }
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
