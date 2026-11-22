"use client";

import React, { useEffect, useState } from "react";

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
};

export default function NotificationsApp() {
  const [status, setStatus] = useState<string>("");
  const [subscribed, setSubscribed] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkStatus = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setChecking(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setSubscribed(false);
        setChecking(false);
        return;
      }
      const res = await fetch(`/my/api/push/is-subscribed?endpoint=${encodeURIComponent(sub.endpoint)}`);
      if (!res.ok) throw new Error(`is-subscribed failed: ${res.status}`);
      const data = await res.json();
      setSubscribed(Boolean(data?.subscribed));
    } catch (e) {
      setStatus(String(e));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(() => checkStatus()).catch((e) => {
        setStatus(String(e));
        setChecking(false);
      });
    } else {
      setChecking(false);
    }
  }, []);

  const subscribe = async () => {
    try {
      if (typeof Notification === "undefined") {
        setStatus("Notifications not supported on this browser (on iOS, add to Home Screen first)");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("Permission denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/my/api/push/vapid-public-key");
      if (!keyRes.ok) throw new Error(`vapid key fetch failed: ${keyRes.status}`);
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error("missing vapid public key");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const subRes = await fetch("/my/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!subRes.ok) throw new Error(`subscribe failed: ${subRes.status}`);
      setSubscribed(true);
      setStatus("Subscribed");
    } catch (e) {
      setStatus(String(e));
    }
  };

  const unsubscribe = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const unRes = await fetch("/my/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!unRes.ok) throw new Error(`unsubscribe failed: ${unRes.status}`);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setStatus("Unsubscribed");
    } catch (e) {
      setStatus(String(e));
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold font-display">Notifications</h1>
      <p className="mt-2 text-text-muted">
        {checking
          ? "Checking subscription status…"
          : subscribed
          ? "This device is subscribed."
          : "This device is not subscribed."}
      </p>
      <div className="flex gap-2 mt-4">
        <button
          onClick={subscribe}
          disabled={subscribed}
          className="px-3 py-1 rounded-sm border border-border bg-surface text-text-primary cursor-pointer disabled:opacity-50"
        >
          Subscribe
        </button>
        <button
          onClick={unsubscribe}
          disabled={!subscribed}
          className="px-3 py-1 rounded-sm border border-border bg-surface text-text-primary cursor-pointer disabled:opacity-50"
        >
          Unsubscribe
        </button>
      </div>
      {status && <p className="mt-2 text-text-muted">{status}</p>}
    </div>
  );
}
