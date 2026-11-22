import * as webpush from "web-push";
import { getVapidKeys } from "./vapid";
import { listSubscriptions, removeSubscription } from "./push-subscriptions";
import { isUploaded } from "./uploads";

async function sendOne(sub: any, title: string, body?: string, image?: string): Promise<void> {
  const keys = getVapidKeys();
  (webpush as any).setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const uploaded = image ? isUploaded(image) : false;
  const fullBody = image && uploaded ? `${body ?? ""}\n[image: ${image}]`.trim() : body;
  try {
    await (webpush as any).sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify({ title, body: fullBody, image: image && uploaded ? image : undefined }),
    );
  } catch (err: any) {
    const status = err?.statusCode;
    if (status === 410 || status === 404) {
      try { await removeSubscription(sub.endpoint); } catch {}
    }
    throw err;
  }
}

export async function notifyOne(sub: any, title: string, body?: string, image?: string): Promise<void> {
  await sendOne(sub, title, body, image);
}

export async function notifyAll(title: string, body?: string, image?: string): Promise<void> {
  const subs = await listSubscriptions();
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendOne(sub, title, body, image);
      } catch {}
    }),
  );
}
