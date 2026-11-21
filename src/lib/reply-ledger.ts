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
function stateDir(): string { return join(process.env.HOME || homedir(), ".use-code-cli"); }
function replyFile(): string { return join(stateDir(), "talk-replies.json"); }
function lockFile(): string { return join(stateDir(), "talk-state.lock"); }

/** Bound the file so a broken caller cannot grow it without limit. */
const MAX_ENTRIES = 200;

export interface ReplyRecord {
  /** msg_id of the message being answered. */
  inReplyTo: string;
  /** sessionId of the session the answer was delivered to. */
  targetSessionId: string;
  /** sessionId of the session that originally sent the message. */
  senderSessionId?: string;
  /** Name of the original sender. */
  senderName?: string;
  /** msg_id assigned to the answer. */
  msgId: string;
  /** Milliseconds since the epoch. */
  at: number;
}

function keyOf(inReplyTo: string, targetSessionId: string): string {
  return `${targetSessionId}\u0000${inReplyTo}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
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
  const parsed = await readJson(replyFile());
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
  await withLock(lockFile(), async () => {
    const key = keyOf(record.inReplyTo, record.targetSessionId);
    const entries = (await loadReplies()).filter(
      (r) => keyOf(r.inReplyTo, r.targetSessionId) !== key,
    );
    entries.push(record);
    await writeJson(replyFile(), entries.slice(-MAX_ENTRIES));
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
  return withLock(lockFile(), async () => {
    const before = await loadReplies();
    const kept = pruneSelfReplies(before, senderSessionId);
    const removed = before.length - kept.length;
    if (removed > 0) {
      await writeJson(replyFile(), kept.slice(-MAX_ENTRIES));
    }
    return removed;
  });
}

/** All reply records whose target session is `targetSessionId`. */
export async function findRepliesForTarget(targetSessionId: string): Promise<ReplyRecord[]> {
  return (await loadReplies()).filter((r) => r.targetSessionId === targetSessionId);
}

/** Remove reply records matching `inReplyTo` + `targetSessionId`. Returns count removed. */
export async function removeReply(inReplyTo: string, targetSessionId: string): Promise<number> {
  return withLock(lockFile(), async () => {
    const before = await loadReplies();
    const kept = before.filter(
      (r) => !(r.inReplyTo === inReplyTo && r.targetSessionId === targetSessionId),
    );
    const removed = before.length - kept.length;
    if (removed > 0) {
      await writeJson(replyFile(), kept.slice(-MAX_ENTRIES));
    }
    return removed;
  });
}
