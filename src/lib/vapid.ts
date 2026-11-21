import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as webpush from "web-push";

function stateDir(): string { return join(process.env.HOME || homedir(), ".use-code-cli"); }
function vapidFile(): string { return join(stateDir(), "vapid.json"); }

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidKeys(): VapidKeys {
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  const envSubject = process.env.VAPID_SUBJECT;
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv, subject: envSubject || "mailto:hill.tw@gmail.com" };
  }
  try {
    if (existsSync(vapidFile())) {
      const parsed = JSON.parse(readFileSync(vapidFile(), "utf8"));
      if (parsed?.publicKey && parsed?.privateKey) {
        return {
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
          subject: envSubject || parsed.subject || "mailto:hill.tw@gmail.com",
        };
      }
    }
  } catch {}
  mkdirSync(stateDir(), { recursive: true });
  const keys = (webpush as any).generateVAPIDKeys();
  const out: VapidKeys = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: envSubject || "mailto:hill.tw@gmail.com",
  };
  writeFileSync(vapidFile(), JSON.stringify(out, null, 2));
  return out;
}