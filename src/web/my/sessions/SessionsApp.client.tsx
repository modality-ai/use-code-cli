"use client";

import React, { useEffect, useState } from "react";
import "../../../lib/web/react-data";

// Client-side enhancement for the sessions page, Next.js style: page.tsx
// imports this 'use client' component. SSR renders the initial list, and the
// client hydrates that markup instead of re-rendering it (Phase 4).

export interface Session {
  name?: string;
  sessionId?: string;
  hero?: string;
  status?: string;
  cwd?: string;
  lastPrompt?: string;
}

function cleanPrompt(text: string): string {
  return String(text || "")
    .replace(/<\/?cross-session-message[^>]*>/g, "")
    .replace(/<!-- use-code-cli:auto-reply[^>]*-->/g, "")
    .replace(/This came from another Claude session[\s\S]*$/g, "")
    .replace(/^Another Claude session sent a message:\n/, "")
    .trim();
}

// Hydration data channel: page.tsx dehydrates the server-rendered sessions here.
// On SSR (no window) falls back to the injected initial prop.
export default function SessionsApp({ initial }: { initial?: Session[] }) {
  const [sessions, setSessions] = useState<Session[]>(() => {
    // Consolidated data channel (Phase B) with prop fallback for SSR.
    const dehydrated = typeof window !== "undefined" ? window.__REACT_DATA__?.sessions : undefined;
    if (Array.isArray(dehydrated)) return dehydrated;
    return Array.isArray(initial) ? initial : [];
  });
  const [error, setError] = useState<string | null>(null);
  // 0 until the first live tick: keeps markup deterministic across SSR and hydration.
  const [lastUpdated, setLastUpdated] = useState(0);
  const [stopping, setStopping] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource("/my/api/sessions/events");
      es.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data);
          if (Array.isArray(d.data)) setSessions(d.data);
          setLastUpdated(Date.now());
          setError(null);
        } catch (e) {
          setError(String(e));
        }
      };
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          if (retry) clearTimeout(retry);
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => {
      if (retry) clearTimeout(retry);
      if (es) es.close();
    };
  }, []);

  const stopSession = async (s: Session) => {
    const name = String(s.sessionId || s.name || "").trim();
    if (!name || stopping) return;
    setStopping(name);
    try {
      await fetch("/my/api/session/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // ignore; SSE refresh will reflect state
    } finally {
      setStopping(null);
    }
  };

  const rows = Array.isArray(sessions) ? sessions : [];
  if (error) return <p className="text-text-primary">Error: {error}</p>;
  if (rows.length === 0) return <p className="text-text-muted">No active sessions.</p>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-md">
        <a href="/" className="text-xs text-accent-collaboration hover:underline">Home</a>
        <span className="text-text-muted">/</span>
        <h1 className="text-2xl font-semibold font-display">Sessions</h1>
        {lastUpdated > 0 && (
          <span className="text-xs text-text-muted font-mono tabular-nums min-w-36 inline-block text-left">
            Live · updated {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>
      {rows.map((s, i) => (
        <div className="border border-border rounded-sm p-3 mb-sm bg-surface" key={i}>
          <a
            href={"/my/session/" + encodeURIComponent(s.sessionId || s.name || "")}
            className="font-semibold text-accent-collaboration hover:underline"
          >
            {s.name || s.sessionId}
          </a>
          <div className="flex items-center justify-between gap-2">
            <span className="font-code text-sm text-text-muted">
              {(s.hero || "-") + " · " + (s.status || "-")}
            </span>
            <button
              type="button"
              className="px-3 py-1 rounded-sm border border-border bg-surface text-text-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => stopSession(s)}
              disabled={stopping === (s.sessionId || s.name)}
              aria-label="Stop the session"
              aria-busy={stopping === (s.sessionId || s.name)}
            >
              {stopping === (s.sessionId || s.name) ? "Stopping…" : "Stop"}
              {stopping === (s.sessionId || s.name) && <span className="sr-only">Stop...</span>}
            </button>
          </div>
          <div className="text-text-muted">{s.cwd || "-"}</div>
          <div>{cleanPrompt(s.lastPrompt || "")}</div>
        </div>
      ))}
    </div>
  );
}

// Hydration is performed automatically by the build shim (see tools/build-client.ts).
