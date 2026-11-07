"use client";

import React, { useEffect, useRef, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import type { SessionData } from "./session-data";
import { onlineEmoji, statusEmoji } from "./store";

// Client-side view for one session, Next.js style: page.tsx imports this
// 'use client' component. The server renders the initial transcript; this
// hydrates it and streams live SSE updates + chat (previously client.ts).

interface Entry {
  role?: string;
  html?: string;
  text?: string;
  tools?: any[];
}

interface BootProps {
  name: string;
  initial?: SessionData | null;
}

function label(e: Entry): string {
  if (e.role === "user") return "❯ You";
  if (e.role === "system") return "📋 Recap";
  return "⏺ Claude";
}

function tryPrettyJson(text: any): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.stringify(JSON.parse(text.trim()), null, 2);
  } catch {}
  let parsedAny = false;
  const out = String(text)
    .split(/\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      try {
        parsedAny = true;
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return line;
      }
    });
  return parsedAny ? out.join("\n") : null;
}

/** Plain-text preview of an entry's message for the pinned one-line row. */
function decodeHtmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function teaserOf(e: Entry): string {
  const source = e.text != null ? String(e.text) : decodeHtmlText(e.html || "");
  return source.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A tool-call fold; its body mounts on first open (was the lazy-body trick). */
function ToolFold({ tool }: { tool: any }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <details
      className="pl-4 mt-1 border border-border rounded-sm p-2"
      onToggle={(ev) => {
        if (ev.currentTarget.open) setLoaded(true);
      }}
    >
      <summary>CLICK TO SEE {tool.name || "tool"}</summary>
      <pre className="whitespace-pre-wrap text-[12px] mt-1">
        {tool.input != null ? JSON.stringify(tool.input, null, 2) : ""}
      </pre>
      {loaded &&
        (tool.resultHtml ? (
          <div className="lazy-body" dangerouslySetInnerHTML={{ __html: tool.resultHtml }} />
        ) : tool.result ? (
          <pre className={tryPrettyJson(tool.result) ? "json whitespace-pre-wrap text-[12px] mt-1" : "whitespace-pre-wrap text-[12px] mt-1"}>
            {tryPrettyJson(tool.result) ?? String(tool.result)}
          </pre>
        ) : null)}
    </details>
  );
}

/**
 * One transcript entry. User entries pin to the container top; while pinned
 * (`.stuck`, set imperatively below) the band collapses to the teaser row and
 * clicking the label folds it open (`.open`, React state).
 */
function Entry({ e, sticky }: { e: Entry; sticky: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapper = "mb-sm" + (sticky ? " sticky top-0 bg-surface" : "") + (open ? " open" : "");
  const labelCls = "relative font-semibold" + (sticky ? " flex items-baseline gap-2 leading-5 cursor-pointer" : "");
  return (
    <div className={wrapper}>
      <div
        className={labelCls + (sticky ? "" : " ") + (e.role === "user" ? " text-accent-collaboration" : e.role === "system" ? " text-text-muted italic" : " text-text-primary")}
        onClick={sticky ? () => setOpen((o) => !o) : undefined}
      >
        {sticky ? (
          <>
            <span className="shrink-0">{label(e)}</span>
            <span className="teaser flex-1 min-w-0 truncate font-normal text-text-muted">{teaserOf(e)}</span>
          </>
        ) : (
          label(e)
        )}
      </div>
      {e.html ? (
        <div className="entry-body pl-4 md-content max-w-none" dangerouslySetInnerHTML={{ __html: e.html }} />
      ) : e.text ? (
        <div className="entry-body pl-4 whitespace-pre-wrap">{e.text}</div>
      ) : null}

      {Array.isArray(e.tools) && e.tools.map((t, i) => <ToolFold key={i} tool={t} />)}
    </div>
  );
}

/**
 * Stuck detection (was updateStuck): pinned wrappers whose top has reached the
 * scrollport's padding edge get `.stuck`. Class toggling is imperative — same
 * technique as the previous client.ts — React renders the rest.
 */
function updateStuck(root: HTMLElement | null): void {
  if (!root) return;
  const cs = getComputedStyle(root);
  const inset = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) + 1;
  const rootTop = root.getBoundingClientRect().top;
  const stickyEls = root.querySelectorAll<HTMLElement>(".sticky.top-0");
  for (const wrapper of stickyEls) {
    wrapper.classList.toggle("stuck", wrapper.getBoundingClientRect().top <= rootTop + inset);
  }
}

// Hydration data channel (Phase B): page.tsx dehydrates { name, initial } into
// the consolidated window.__REACT_DATA__ object; the server render reads the
// same values via props.
function readBoot(props: BootProps): BootProps {
  const injected = typeof window !== "undefined" ? window.__REACT_DATA__?.sessionView : undefined;
  return injected ?? props;
}

export default function SessionView(props: BootProps & { payload?: string }) {
  // The payload script lives inside the hydrated node: React hydration never
  // compares dangerouslySetInnerHTML content, so the server value survives
  // while the client-side render supplies an empty peer.
  const payloadHtml = props.payload ?? "";
  const boot = useRef<BootProps>(readBoot(props));
  const name = boot.current.name || "";
  const initial = boot.current.initial ?? null;

  const [entries, setEntries] = useState<Entry[]>(() =>
    initial?.success && Array.isArray(initial.data?.entries) ? initial.data.entries : [],
  );
  const [meta, setMeta] = useState<{ success: boolean; online: boolean; status: string | null }>(() =>
    initial?.success
      ? { success: true, online: initial.data?.online !== false, status: (initial.data?.status as string | null) || "idle" }
      : { success: false, online: false, status: "idle" },
  );
  const [chatStatus, setChatStatus] = useState(""); // send progress + SSE errors
  const [reconnecting, setReconnecting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const autoscrollRef = useRef<HTMLInputElement>(null);
  // While "Auto-scroll to bottom" is unchecked the page freezes: no state
  // updates, no status churn — DOM stays put while the user reads history.
  const liveRef = useRef(true);

  const applyMeta = (d: any) => {
    setReconnecting(false);
    setMeta(d.success ? { success: true, online: d.data?.online !== false, status: (d.data?.status as string | null) || "idle" } : { success: false, online: false, status: "idle" });
  };

  const applyEntries = (d: any) => {
    if (d.success && Array.isArray(d.data?.entries)) {
      setEntries(d.data.entries);
    }
  };

  /** Full catch-up: reload entries + state (initial paint, and on re-enabling). */
  const catchUp = async () => {
    if (!liveRef.current) return;
    try {
      const r = await fetch("/api/session?name=" + encodeURIComponent(name));
      const d = await r.json();
      if (!liveRef.current) return;
      applyEntries(d);
      applyMeta(d);
    } catch {}
  };

  useEffect(() => {
    if (!name) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    const connect = () => {
      es = new EventSource("/api/session/events?name=" + encodeURIComponent(name));
      es.onmessage = (ev: MessageEvent) => {
        if (!liveRef.current) return;
        retryDelay = 1000; // reset backoff on successful message
        try {
          const d = JSON.parse(ev.data);
          if (d.error) {
            setChatStatus("Error: " + d.error);
          } else {
            if (Array.isArray(d.data?.entries)) setEntries(d.data.entries);
            applyMeta(d);
            setReconnecting(false);
          }
        } catch {}
      };
      es.onerror = () => {
        if (!liveRef.current) return;
        setReconnecting(true);
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          if (retry) clearTimeout(retry);
          const delay = Math.min(retryDelay, 30000) + Math.floor(Math.random() * 250);
          retry = setTimeout(connect, delay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      };
    };
    connect();
    return () => {
      const cached = es;
      cached?.close();
      es = null;
      if (retry) clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // First paint catch-up (SSE pushes full entries on connect too).
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    catchUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Post-paint passes: stuck flags + auto-scroll (when enabled).
  useEffect(() => {
    updateStuck(scrollRef.current);
    const root = scrollRef.current;
    const onScroll = () => updateStuck(root);
    root?.addEventListener("scroll", onScroll, { passive: true });
    return () => root?.removeEventListener("scroll", onScroll);
  });

  // Auto-scroll on transcript growth when enabled.
  useEffect(() => {
    const sc = autoscrollRef.current;
    if (sc?.checked) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  const stateText = reconnecting
    ? "🔄 reconnecting…"
    : !meta.success
    ? "⚠️ unavailable"
    : `${statusEmoji(meta.status || "idle")} ${meta.status || "idle"} · ${onlineEmoji(meta.online)} ${meta.online ? "active" : "offline"}`;
  const chatOpen = meta.success && meta.online;

  const send = async () => {
    const input = chatRef.current;
    if (!input || !input.value.trim()) return;
    setChatStatus("sending...");
    try {
      const r = await fetch("/api/talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message: input.value }),
      });
      const d = await r.json();
      if (d.success) {
        setChatStatus("sent");
        input.value = "";
      } else {
        setChatStatus("error: " + (d.error || "failed"));
      }
    } catch (e) {
      setChatStatus("error: " + String(e));
    }
  };

  return (
    <div>
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: payloadHtml }} />

      <div className="flex items-center gap-3 mb-md">
        <a href="/sessions" className="text-[12px] text-accent-collaboration hover:underline">← Back to sessions</a>
        <h1 className="text-2xl font-semibold font-display">{name || "Session"}</h1>
      </div>
      <div id="transcript" ref={scrollRef} className="border border-border rounded-sm p-3 bg-surface font-code text-[13px] max-h-[70vh] overflow-auto">
        {entries.length === 0 ? (
          <p className="text-text-muted">Loading session transcript...</p>
        ) : (
          entries.map((e, i) => <Entry key={i} e={e} sticky={e.role === "user"} />)
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="flex items-center gap-1 text-[12px] text-text-muted cursor-pointer">
          <input
            id="autoscroll"
            ref={autoscrollRef}
            type="checkbox"
            defaultChecked
            onChange={() => {
              const sc = autoscrollRef.current;
              liveRef.current = !sc || sc.checked;
              if (liveRef.current) catchUp();
            }}
          />
          Auto-scroll to bottom
        </label>
        <button
          type="button"
          id="scroll-top"
          className="text-[12px] text-text-muted border border-border rounded-sm px-2 py-0.5 cursor-pointer"
          onClick={() => scrollRef.current && (scrollRef.current.scrollTop = 0)}
        >
          ↑ Top
        </button>
        <button
          type="button"
          id="scroll-bottom"
          className="text-[12px] text-text-muted border border-border rounded-sm px-2 py-0.5 cursor-pointer"
          onClick={() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight)}
        >
          ↓ Bottom
        </button>
        <span id="session-state" className="text-[12px] text-text-muted ml-auto">{stateText}</span>
      </div>
      <div className="chat-input" style={{ display: chatOpen ? "flex" : "none" }}>
        <input
          id="chat-input"
          ref={chatRef}
          type="text"
          placeholder="Send a message to this session..."
          onKeyDown={(ev) => {
            if (ev.key === "Enter") send();
          }}
        />
        <button id="chat-send" onClick={send}>Send</button>
      </div>
      <div id="chat-status" className="text-[12px] text-text-muted mt-1">{chatStatus}</div>
    </div>
  );
}

// Hydration entry: server renders the initial transcript; reuse it client-side.
// The element includes SessionView only (page.tsx imports the component for SSR).
if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (root) hydrateRoot(root, React.createElement(SessionView));
}
