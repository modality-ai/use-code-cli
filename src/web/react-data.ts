import type { Session } from "./sessions/SessionsApp.client";
import type { SessionData } from "./session/[name]/session-data";

/**
 * Single data channel for hydrated routes: page.tsx dehydrates its slice into
 * `window.__REACT_DATA__`; 'use client' components read it for hydration.
 * One namespace and per-route slices replace per-route `window.__X__` globals
 * (legacy globals coexist until Phase C removes them).
 */
export interface ReactDataEnvelope {
  sessions?: Session[];
  sessionView?: {
    name: string;
    initial: SessionData | null;
  };
  // Future slices appended here as new hydrated routes are added.
}

declare global {
  interface Window {
    __REACT_DATA__?: ReactDataEnvelope;
  }
}
