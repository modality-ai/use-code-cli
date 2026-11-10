import React from "react";
import PasskeyApp from "./PasskeyApp.client";
import { loadStore } from "../api/webauthn/store";
import { getRpConfig } from "../../lib/web/auth";

export interface PasskeyPageProps {
  hasCredentials?: boolean;
}

export default function PasskeyPage(props: PasskeyPageProps) {
  const hasCredentials = !!props?.hasCredentials;
  const json = JSON.stringify(hasCredentials).replace(/</g, "\\u003c");
  return <PasskeyApp initial={hasCredentials} payloadHtml={`window.__REACT_DATA__ = { passkey: { hasCredentials: ${json} } };`} />;
}

export async function loadData(args?: { request?: Request }) {
  const store = await loadStore();
  const { rpID } = getRpConfig(args?.request);
  const hasCredentials = !!(store && (store.credentials || []).some((c: any) => c.rpId === rpID || (!c.rpId && rpID === "localhost")));
  return { hasCredentials };
}