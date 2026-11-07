import React from "react";
import TunnelApp from "./TunnelApp.client";

export interface TunnelPageProps {
  url?: string | null;
}

export default function TunnelPage(props: TunnelPageProps = {}) {
  return <TunnelApp url={props.url} />;
}

export async function loadData(): Promise<TunnelPageProps> {
  // Don't trust persisted URL across restarts; client verifies liveness via API.
  return { url: null };
}
