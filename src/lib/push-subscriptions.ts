import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { withLock } from "./file-lock";

function stateDir(): string { return join(process.env.HOME || homedir(), ".use-code-cli"); }
function subsFile(): string { return join(stateDir(), "push-subscriptions.json"); }
function lockFile(): string { return join(stateDir(), "push-subscriptions.lock"); }

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  createdAt: number;
}

async function readAll(): Promise<PushSubscriptionRecord[]> {
  try {
    if (!existsSync(subsFile())) return [];
    const raw = readFileSync(subsFile(), "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as PushSubscriptionRecord[];
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed) as PushSubscriptionRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

async function writeAll(records: PushSubscriptionRecord[]): Promise<void> {
  mkdirSync(stateDir(), { recursive: true });
  const tmp = `${subsFile()}.tmp.${process.pid}`;
  const { writeFile, rename } = await import("node:fs/promises");
  await writeFile(tmp, JSON.stringify(records, null, 2));
  await rename(tmp, subsFile());
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  return readAll();
}

export async function addSubscription(rec: PushSubscriptionRecord): Promise<void> {
  await withLock(lockFile(), async () => {
    const all = await readAll();
    const filtered = all.filter((r) => r.endpoint !== rec.endpoint);
    filtered.push(rec);
    await writeAll(filtered);
  });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await withLock(lockFile(), async () => {
    const all = await readAll();
    const filtered = all.filter((r) => r.endpoint !== endpoint);
    await writeAll(filtered);
  });
}