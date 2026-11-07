import React from "react";
import SessionView from "./SessionView.client";
import { fetchSessionData, SessionData } from "./session-data";

export interface SessionPageProps {
  name?: string;
  data?: SessionData | null;
}

// Next.js style: the page renders only the hydrated component (its markup is
// the data channel); the server snapshot arrives via the payload + props.
export default function SessionPage(props: SessionPageProps) {
  const name = props?.name || "";
  const data = props?.data ?? null;
  // Single data channel (Phase B): the consolidated __REACT_DATA__ slice only.
  const json = JSON.stringify({ name, initial: data }).replace(/</g, "\\u003c");
  const payloadHtml = `window.__REACT_DATA__ = { sessionView: ${json} };`;
  return <SessionView name={name} initial={data} payload={payloadHtml} />;
}

export async function loadData(props?: { params?: Record<string, string>; name?: string }): Promise<SessionPageProps> {
  const name = props?.name || props?.params?.name || "";
  const data = name ? await fetchSessionData(name, { includeEntries: false }) : { success: false, error: "missing name" };
  return { name, data };
}

