import { mkdirSync } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

export interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
}

const DEFAULTS = { timeoutMs: 2000, staleMs: 5000, retryMs: 25 };

/**
 * Run `fn` while holding an exclusive file lock. Uses atomic `open(..., "wx")`
 * creation; a lock left by a crashed process is broken after `staleMs`.
 */
export async function withLock<T>(
  lockFile: string,
  fn: () => T | Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const { timeoutMs, staleMs, retryMs } = { ...DEFAULTS, ...opts };
  const dir = lockFile.slice(0, lockFile.lastIndexOf("/"));
  if (dir) mkdirSync(dir, { recursive: true });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lockFile, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let stale = false;
      try {
        stale = Date.now() - (await stat(lockFile)).mtimeMs > staleMs;
      } catch {
        stale = false;
      }
      if (stale) {
        try { await unlink(lockFile); } catch {}
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the state lock (${lockFile})`);
      }
      await sleep(retryMs);
    }
  }

  try {
    return await fn();
  } finally {
    try { await unlink(lockFile); } catch {}
  }
}
