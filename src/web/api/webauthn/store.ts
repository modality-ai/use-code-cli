import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthenticatorTransport } from "@simplewebauthn/server";

export interface StoredCredential {
  id: string; // base64url credential id
  publicKey: string; // base64
  counter: number;
  transports?: AuthenticatorTransport[];
  rpId?: string; // RP ID this credential was registered for
}

export interface WebAuthnStore {
  userId: string;
  userName: string;
  displayName: string;
  credentials: StoredCredential[];
}

function storePath() {
  return join(process.env.HOME || homedir(), ".use-code-cli", "webauthn.json");
}

export async function loadStore(): Promise<WebAuthnStore | null> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.credentials)) return parsed as WebAuthnStore;
    return null;
  } catch {
    return null;
  }
}

export async function saveStore(store: WebAuthnStore): Promise<void> {
  const dir = join(process.env.HOME || homedir(), ".use-code-cli");
  await mkdir(dir, { recursive: true });
  const tmp = `${storePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tmp, storePath());
}

export async function getOrCreateUser() {
  let store = await loadStore();
  if (!store) {
    store = {
      userId: Buffer.from(randomId()).toString("base64url"),
      userName: "owner",
      displayName: "Owner",
      credentials: [],
    };
    await saveStore(store);
  }
  return store;
}

function randomId(): Uint8Array {
  return randomBytes(16);
}

export function toUint8Array(b64urlOrBuf: string | Buffer): Uint8Array {
  if (Buffer.isBuffer(b64urlOrBuf)) return new Uint8Array(b64urlOrBuf);
  const s = b64urlOrBuf.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return new Uint8Array(Buffer.from(s + pad, "base64"));
}

export function bufToBase64(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf).toString("base64");
}

export function base64ToBuf(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}