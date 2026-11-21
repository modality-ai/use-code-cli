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

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) => setStatus(String(e)));
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
      const { publicKey } = await keyRes.json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/my/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
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
        await fetch("/my/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
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
      <div className="flex gap-2 mt-4">
        <button onClick={subscribe} className="px-3 py-1 rounded-sm border border-border bg-surface text-text-primary cursor-pointer">
          Subscribe
        </button>
        <button onClick={unsubscribe} className="px-3 py-1 rounded-sm border border-border bg-surface text-text-primary cursor-pointer">
          Unsubscribe
        </button>
      </div>
      {status && <p className="mt-2 text-text-muted">{status}</p>}
    </div>
  );
}