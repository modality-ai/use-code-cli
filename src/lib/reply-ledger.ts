import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { prettyJsonFile } from "./output/json";
import { withLock } from "./file-lock";

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
  await writeFile(tmp, prettyJsonFile(value));
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
  await withLock(LOCK_FILE, async () => {
    const key = keyOf(record.inReplyTo, record.targetSessionId);
    const entries = (await loadReplies()).filter(
      (r) => keyOf(r.inReplyTo, r.targetSessionId) !== key,
    );
    entries.push(record);
    await writeJson(REPLY_FILE, entries.slice(-MAX_ENTRIES));
  });
}

/** Pure core: drop ledger entries whose target is the sender session (self-replies). */
export function pruneSelfReplies(
  records: ReplyRecord[],
  senderSessionId: string,
): ReplyRecord[] {
  return records.filter((r) => r.targetSessionId !== senderSessionId);
}

/** Remove ledger entries whose target is the sender session (self-replies). */
export async function cleanRepliesForSender(senderSessionId: string): Promise<number> {
  return withLock(LOCK_FILE, async () => {
    const before = await loadReplies();
    const kept = pruneSelfReplies(before, senderSessionId);
    const removed = before.length - kept.length;
    if (removed > 0) {
      await writeJson(REPLY_FILE, kept.slice(-MAX_ENTRIES));
    }
    return removed;
  });
}
