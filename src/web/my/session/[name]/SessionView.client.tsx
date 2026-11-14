"use client";

import React, { useEffect, useRef, useState } from "react";
import "../../../../lib/web/react-data";
import type { SessionData } from "./session-data";
import { onlineEmoji, statusEmoji } from "./store";
import ChatInput from "./ChatInput";
import { prettyJson, tryPrettyJson } from "../../../../lib/output/json";

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

/** Pinned context indicator: most recent user entry fully scrolled past. */
type BarState = { index: number; teaser: string } | null;

export function label(e: Entry): string {
  if (e.role === "user") return "❯ You";
  if (e.role === "system") return "📋 Recap";
  return "⏺ Claude";
}

/** Plain-text preview of an entry's message for the pinned one-line row. */
export function decodeHtmlText(html: string): string {
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

export function teaserOf(e: Entry): string {
  const source = e.text != null ? String(e.text) : decodeHtmlText(e.html || "");
  return source.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A tool-call fold; its body (input + result) mounts on first open, and the
 *  result is fetched on demand if it wasn't shipped in the initial payload. */
function ToolFold({ tool, sessionName }: { tool: any; sessionName?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState<any>(tool.input);
  const [result, setResult] = useState<string | undefined>(tool.result);
  const [resultHtml, setResultHtml] = useState<string | undefined>(tool.resultHtml);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(!!(tool.input || tool.result || tool.resultHtml));
  const onToggle = async (ev: any) => {
    if (!ev.currentTarget.open) return;
    setLoaded(true);
    if (fetched) return;
    if (!tool.id || !sessionName) { setFetched(true); return; }
    setLoading(true);
    try {
      const r = await fetch(`/my/api/session/tool-result?name=${encodeURIComponent(sessionName)}&toolId=${encodeURIComponent(tool.id)}`);
      const d = await r.json();
      if (d?.success) {
        setInput(d.input);
        setResult(d.result);
        setResultHtml(d.resultHtml);
      }
    } catch {
      // ignore; keep empty
    } finally {
      setLoading(false);
      setFetched(true);
    }
  };
  return (
    <details
      className="pl-4 mt-1 border border-border rounded-sm p-2"
      onToggle={onToggle}
    >
      <summary>CLICK TO SEE {tool.name || "tool"}</summary>
      {loaded && (
        <>
          {(() => {
            const tname = String(tool?.name || "").toLowerCase();
            const isDiffTool = tname === "write" || tname === "edit" || tname === "read";
            if (isDiffTool) {
              return (
                <>
                  {loading && <div className="text-text-muted text-xs mt-1">Loading…</div>}
                  {!loading && (resultHtml ? (
                    <div className="lazy-body" dangerouslySetInnerHTML={{ __html: resultHtml }} />
                  ) : null)}
                </>
              );
            }
            return (
              <>
                <pre className="whitespace-pre-wrap text-xs mt-1">
                  {input != null ? prettyJson(input) : ""}
                </pre>
                {loading && <div className="text-text-muted text-xs mt-1">Loading…</div>}
                {!loading && (resultHtml ? (
                  <div className="lazy-body" dangerouslySetInnerHTML={{ __html: resultHtml }} />
                ) : result ? (() => {
                  const pretty = tryPrettyJson(result);
                  return (
                    <pre className={(pretty ? "json " : "") + "whitespace-pre-wrap text-xs mt-1"}>
                      {pretty ?? String(result)}
                    </pre>
                  );
                })() : null)}
              </>
            );
          })()}
        </>
      )}
    </details>
  );
}

/** Entry payload: body + tool folds, shared by the transcript and the
    context chip's expand panel (must never change outer layout). */
function EntryBody({ e, sessionName }: { e: Entry; sessionName?: string }) {
  return (
    <>
      {e.html ? (
        <div className="entry-body pl-4 md-content max-w-none" dangerouslySetInnerHTML={{ __html: e.html }} />
      ) : e.text ? (
        <div className="entry-body pl-4 whitespace-pre-wrap">{e.text}</div>
      ) : null}

      {Array.isArray(e.tools) && e.tools.map((t, i) => <ToolFold key={i} tool={t} sessionName={sessionName} />)}
    </>
  );
}

/**
 * One transcript entry, rendered plain: entries scroll untouched (natural
 * heights, no sticky, no collapse) — the pinned context indicator lives in
 * the container's sticky bar below.
 */
function Entry({ e, sessionName }: { e: Entry; sessionName?: string }) {
  return (
    <div className="mb-sm entry" data-role={e.role || ""}>
      <div className={"relative font-semibold " + (e.role === "user" ? " text-accent-collaboration" : e.role === "system" ? " text-text-muted italic" : " text-text-primary")}>
        {label(e)}
      </div>
      <EntryBody e={e} sessionName={sessionName} />
    </div>
  );
}

/**
 * Context-bar detection (was updateStuck): the most recent user entry that has
 * fully scrolled past the container's padding edge feeds the sticky indicator
 * React state. Guarded set — the post-paint effect runs every render.
 */
export const BAR_BAND = 34; // px — reserved layout space, matches the bar's height

export function updateBar(root: HTMLElement | null, entries: Entry[], last: BarState): BarState {
  if (!root) return null;
  const rootTop = root.getBoundingClientRect().top;
  const cs = getComputedStyle(root);
  const edge = rootTop + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
  const els = root.querySelectorAll<HTMLElement>(".entry");
  let candidate = -1;
  for (let i = 0; i < els.length; i++) {
    const el = els.item(i);
    if (!el) continue;
    if ((entries[i]?.role || el.dataset.role) !== "user") continue;
    if (el.getBoundingClientRect().bottom <= edge) candidate = i;
  }
  const picked: Entry | undefined = candidate >= 0 ? entries[candidate] : undefined;
  const next: BarState = picked ? { index: candidate, teaser: teaserOf(picked) } : null;
  if ((next?.index ?? -1) === (last?.index ?? -1) && (next?.teaser ?? "") === (last?.teaser ?? "")) return last;
  return next;
}

// Hydration data channel (Phase B): page.tsx dehydrates { name, initial } into
// the consolidated window.__REACT_DATA__ object; the server render reads the
// same values via props.
function readBoot(props: BootProps): BootProps {
  const injected = typeof window !== "undefined" ? window.__REACT_DATA__?.sessionView : undefined;
  return injected ?? props;
}

export default function SessionView(props: BootProps) {
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
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const autoscrollRef = useRef<HTMLInputElement>(null);
  const [bar, setBar] = useState<BarState>(null);
  const [barOpen, setBarOpen] = useState<number | null>(null);
  const barRef = useRef<BarState>(null);
  barRef.current = bar;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // The expand panel tracks the chip: it closes when the pinned message
  // changes (chip target moved to another entry) or the chip disappears.
  useEffect(() => {
    if (barOpen !== null && (!bar || bar.index !== barOpen)) setBarOpen(null);
  }, [bar, barOpen]);
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
      const r = await fetch("/my/api/session?name=" + encodeURIComponent(name));
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
      es = new EventSource("/my/api/session/events?name=" + encodeURIComponent(name));
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

  // Context bar follows scrolling.
  useEffect(() => {
    const root = scrollRef.current;
    const onScroll = () => setBar((b) => updateBar(root, entriesRef.current, b));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep page content from being hidden behind the fixed bottom bar: measure
  // the bar's rendered height and apply it as bottom padding to the content.
  useEffect(() => {
    const bar = bottomBarRef.current;
    const content = contentRef.current;
    if (!bar || !content) return;
    const apply = () => {
      content.style.paddingBottom = `${bar.offsetHeight + 8}px`;
    };
    apply();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(apply);
      ro.observe(bar);
      // store for cleanup via closure
      (content as any)._ro = ro;
    }
    window.addEventListener("resize", apply);
    return () => {
      if ((content as any)._ro) (content as any)._ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  // First paint catch-up (SSE pushes full entries on connect too).
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    catchUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Post-paint pass: refresh the context-bar target (guarded set in updateBar).
  useEffect(() => {
    setBar((b) => updateBar(scrollRef.current, entries, b));
  });

  // Scroll maintenance on transcript growth (entries only — bar changes must
  // never yank the scroll position while the user reads history):
  //  - auto-scroll to bottom (when enabled)
  //  - otherwise freeze the view on the same transcript line, re-anchoring for
  //    any pinned context-bar space that appeared above
  //  - without the bar, plain growth below keeps scrollTop untouched
  useEffect(() => {
    const root = scrollRef.current;
    const sc = autoscrollRef.current;
    if (!root) return;
    if (sc?.checked) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
      return;
    }
    // When not auto-scrolling, leave the viewport where it is (the page, not an
    // inner container, now owns scrolling).
  }, [entries]);

  const stateText = reconnecting
    ? "🔄 reconnecting…"
    : !meta.success
    ? "⚠️ unavailable"
    : `${statusEmoji(meta.status || "idle")} ${meta.status || "idle"} · ${onlineEmoji(meta.online)} ${meta.online ? "active" : "offline"}`;
  const chatOpen = meta.success && meta.online;

  const send = async () => {
    const input = chatRef.current;
    if (!input || !input.value.trim() || sending) return;
    setSending(true);
    setChatStatus("sending...");
    try {
      const r = await fetch("/my/api/talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message: input.value }),
      });
      const d = await r.json();
      const inner = d?.data;
      if (d.success && inner?.success !== false) {
        setChatStatus("sent");
        input.value = "";
      } else {
        setChatStatus("error: " + (inner?.message || d.error || "failed"));
      }
    } catch (e) {
      setChatStatus("error: " + String(e));
    } finally {
      setSending(false);
    }
  };

  const pause = async () => {
    if (pausing) return;
    setPausing(true);
    setChatStatus("pausing...");
    try {
      const r = await fetch("/my/api/session/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (d?.success) {
        setChatStatus("paused (frozen)");
        // Refresh session status so the header reflects the return to idle.
        // statusOnly=1: we only read online/status here — skip the transcript.
        try {
          const metaRes = await fetch("/my/api/session?statusOnly=1&name=" + encodeURIComponent(name));
          const metaJson = await metaRes.json();
          if (metaJson?.success) {
            setMeta({ success: true, online: metaJson.data?.online !== false, status: (metaJson.data?.status as string | null) || "idle" });
          }
        } catch {}
      } else {
        setChatStatus("error: " + (d?.error || "failed"));
      }
    } catch (e) {
      setChatStatus("error: " + String(e));
    } finally {
      setPausing(false);
    }
  };

  const barEntry: Entry | undefined = bar && barOpen === bar.index ? entries[bar.index] : undefined;

  return (
    <div ref={contentRef}>
      <div className="flex items-center gap-3 mb-md">
        <a href="/my/sessions" className="text-xs text-accent-collaboration hover:underline">← Back to sessions</a>
        <h1 className="text-2xl font-semibold font-display">{(initial?.data?.name as string | undefined) || name || "Session"}</h1>
      </div>
      <div id="transcript" ref={scrollRef} className="border border-border rounded-sm p-3 bg-surface font-code text-sm">
        <div
          id="context-bar"
          className="sticky -top-3 z-10 flex items-baseline gap-2 h-8 bg-surface text-sm cursor-pointer shadow-md"
          style={{ visibility: bar ? "visible" : "hidden" }}
          onClick={() => setBarOpen((i) => (bar && i === bar.index ? null : bar?.index ?? null))}
        >
          <span className="shrink-0 font-semibold text-accent-collaboration">❯ You</span>
          <span className="flex-1 min-w-0 truncate font-normal text-text-muted">{bar ? bar.teaser : " "}</span>
          {barEntry && (
            /* Absolute overlay under the chip: opening never reflows the
               transcript, so the scroll position stays exactly where it is. */
            <div
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-pinned overflow-auto border border-border rounded-sm bg-surface p-3 shadow-md"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="mb-1 text-xs text-text-muted uppercase tracking-wide">pinned message</div>
              <EntryBody e={barEntry} sessionName={name} />
            </div>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-text-muted">Loading session transcript...</p>
        ) : (
          entries.map((e, i) => <Entry key={i} e={e} sessionName={name} />)
        )}
      </div>
      <div ref={bottomBarRef} className="flex flex-col gap-2 fixed bottom-0 left-0 right-0 z-20 bg-surface p-2" role="region" aria-label="Session controls">
        <div className="flex items-center gap-2" role="toolbar" aria-label="Session scroll controls">
        <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
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
          aria-label="Scroll to top"
          className="text-xs text-text-muted border border-border rounded-sm px-2 py-0.5 cursor-pointer"
          onClick={() => window.scrollTo({ top: 0 })}
        >
          ↑ Top
        </button>
        <button
          type="button"
          id="scroll-bottom"
          aria-label="Scroll to bottom"
          className="text-xs text-text-muted border border-border rounded-sm px-2 py-0.5 cursor-pointer"
          onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight })}
        >
          ↓ Bottom
        </button>
        <span id="session-state" role="status" aria-live="polite" className="text-xs text-text-muted ml-auto">{stateText}</span>
        </div>
      <ChatInput
        chatOpen={chatOpen}
        chatRef={chatRef}
        chatStatus={chatStatus}
        sending={sending}
        busy={meta.status === "busy"}
        onSend={send}
        onPause={pause}
      />
    </div>
    </div>
  );
}

// Hydration is performed automatically by the build shim (see tools/build-client.ts).
