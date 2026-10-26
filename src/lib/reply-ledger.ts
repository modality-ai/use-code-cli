import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Small per-user state file for loop safety: which msg_ids this machine
 * already answered, so `--in-reply-to` is idempotent even when an agent
 * retries or two relays race.
 *
 * The file is read-modify-written, so every write takes the lock.
 */
const STATE_DIR = join(homedir(), ".use-code-cli");
const REPLY_FILE = join(STATE_DIR, "talk-replies.json");
const LOCK_FILE = join(STATE_DIR, "talk-state.lock");

/** Bound the file so a broken caller cannot grow it without limit. */
const MAX_ENTRIES = 200;

const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 25;

export interface ReplyRecord {
  /** msg_id of the message being answered. */
  inReplyTo: string;
  /** sessionId of the session the answer was delivered to. */
  targetSessionId: string;
  /** msg_id assigned to the answer. */
  msgId: string;
  /** Milliseconds since the epoch. */
  at: number;
}

function keyOf(inReplyTo: string, targetSessionId: string): string {
  return `${targetSessionId}\u0000${inReplyTo}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, path);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // Missing or corrupt: an empty state is always safe.
    return undefined;
  }
}

/**
 * Take the state lock before a read-modify-write. `open(..., "wx")` is atomic,
 * so two concurrent replies cannot both read the same old ledger and drop one
 * entry. A lock left by a crashed process is broken after LOCK_STALE_MS.
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(STATE_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      const handle = await open(LOCK_FILE, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (await isStaleLock()) {
        await unlink(LOCK_FILE).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the state lock (${LOCK_FILE})`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(LOCK_FILE).catch(() => {});
  }
}

async function isStaleLock(): Promise<boolean> {
  try {
    return Date.now() - (await stat(LOCK_FILE)).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function isReplyRecord(value: unknown): value is ReplyRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.inReplyTo === "string" &&
    typeof r.targetSessionId === "string" &&
    typeof r.msgId === "string" &&
    typeof r.at === "number"
  );
}

async function loadReplies(): Promise<ReplyRecord[]> {
  const parsed = await readJson(REPLY_FILE);
  return Array.isArray(parsed) ? parsed.filter(isReplyRecord) : [];
}

/** The reply this session already sent to `inReplyTo`, if any. */
export async function findReply(
  inReplyTo: string,
  targetSessionId: string,
): Promise<ReplyRecord | undefined> {
  const key = keyOf(inReplyTo, targetSessionId);
  return (await loadReplies()).find(
    (r) => keyOf(r.inReplyTo, r.targetSessionId) === key,
  );
}

/** Remember a sent reply. Atomic write: a crash never corrupts the ledger. */
export async function recordReply(record: ReplyRecord): Promise<void> {
  await withLock(async () => {
    const key = keyOf(record.inReplyTo, record.targetSessionId);
    const entries = (await loadReplies()).filter(
      (r) => keyOf(r.inReplyTo, r.targetSessionId) !== key,
    );
    entries.push(record);
    await writeJson(REPLY_FILE, entries.slice(-MAX_ENTRIES));
  });
}
