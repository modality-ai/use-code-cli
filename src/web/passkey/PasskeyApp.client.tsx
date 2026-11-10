"use client";

import React, { useEffect, useState } from "react";

export interface PasskeyAppProps {
  initial?: boolean;
  payloadHtml?: string;
}

export default function PasskeyApp({ initial, payloadHtml }: PasskeyAppProps = {}) {
  const dehydrated =
    typeof window !== "undefined" ? (window as any).__REACT_DATA__?.passkey : undefined;
  const payload = payloadHtml ?? "";
  const [status, setStatus] = useState<string>("");
  const [hasCredentials, setHasCredentials] = useState<boolean>(() => {
    if (typeof dehydrated?.hasCredentials === "boolean") return dehydrated.hasCredentials;
    return !!initial;
  });
  const [loggedIn, setLoggedIn] = useState<boolean>(false);

  useEffect(() => {
    fetch("/api/webauthn/status")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.hasCredentials === "boolean") setHasCredentials(d.hasCredentials);
        if (d?.authenticated) {
          setLoggedIn(true);
          setStatus("Signed in");
        } else {
          setLoggedIn(false);
          setStatus("");
        }
      })
      .catch(() => {});
  }, []);

  async function register() {
    setStatus("Registering...");
    try {
      const r = await fetch("/api/webauthn/register/options", { method: "POST" });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || "options failed");
      const { startRegistration } = await import("@simplewebauthn/browser");
      const attResp = await startRegistration({ optionsJSON: d.options });
      const v = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attResp, challengeId: d.challengeId }),
      });
      const vd = await v.json();
      if (vd.success) setHasCredentials(true);
      setStatus(vd.success ? "Registered & signed in" : "Register failed: " + (vd.error || "unknown"));
    } catch (e) {
      setStatus("Register error: " + String(e));
    }
  }

  async function login() {
    setStatus("Logging in...");
    try {
      const r = await fetch("/api/webauthn/login/options", { method: "POST" });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || "options failed");
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const authResp = await startAuthentication({ optionsJSON: d.options });
      const v = await fetch("/api/webauthn/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResp, challengeId: d.challengeId }),
      });
      const vd = await v.json();
      if (vd.success) setLoggedIn(true);
      setStatus(vd.success ? "Signed in" : "Login failed: " + (vd.error || "unknown"));
    } catch (e) {
      setStatus("Login error: " + String(e));
    }
  }

  async function logout() {
    await fetch("/api/webauthn/logout", { method: "POST" });
    setLoggedIn(false);
    setStatus("Signed out");
  }

  return (
    <div className="max-w-3xl mx-auto my-6 p-4">
      <script dangerouslySetInnerHTML={{ __html: payload }} />
      <h1 className="text-2xl font-semibold font-display mb-md">Passkey Login</h1>
      <p className="text-text-muted mb-md">Register or sign in with a passkey (WebAuthn).</p>
      <div className="flex gap-2 mb-md">
        {!hasCredentials && !loggedIn && (
          <button onClick={register} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold">Register</button>
        )}
        <button onClick={login} className="px-3 py-2 rounded-sm border border-border">Login</button>
        <button onClick={logout} className="px-3 py-2 rounded-sm border border-border">Logout</button>
      </div>
      <pre className="font-code text-sm text-text-muted whitespace-pre-wrap">{status}</pre>
    </div>
  );
}