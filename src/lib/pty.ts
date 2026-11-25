import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "./file-lock";

// Live PTY jobs: jobId -> { proc, log? }. Both foreground (streamed) and
// background (logged) jobs register here so the browser can send keystrokes
// via /my/api/pty/input. Exited jobs are evicted automatically.

export type PtyProc = Bun.Subprocess & { terminal: NonNullable<Bun.Subprocess["terminal"]> };

interface PtyJob {
  proc: Bun.Subprocess;
  log?: string;
}

interface PtyJobRecord {
  jobId: string;
  pid: number;
  log?: string;
  cwd?: string;
  command?: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  background?: boolean;
}

const jobs = new Map<string, PtyJob>();
let jobSeq = 0;

// Test-only bypass for unit tests that exercise the in-memory registry.
// Production keeps filesystem persistence enabled; callers that disable it
// must restore the previous value when the test finishes.
let persistJobs = true;
let memoryRecords: PtyJobRecord[] = [];

export function setPtyJobPersistenceEnabled(enabled: boolean): boolean {
  const previous = persistJobs;
  persistJobs = enabled;
  if (enabled) memoryRecords = [];
  return previous;
}

function stateDir(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli");
}

function jobsFile(): string {
  return join(stateDir(), "pty-jobs.json");
}

function jobsLock(): string {
  return join(stateDir(), "pty-jobs.lock");
}

function ensureStateDir(): void {
  try { mkdirSync(stateDir(), { recursive: true }); } catch {}
}

function readPersistedJobsSync(): PtyJobRecord[] {
  try {
    if (!existsSync(jobsFile())) return [];
    const raw = JSON.parse(readFileSync(jobsFile(), "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

// One lock covers the whole read-modify-write; separate locks would let
// concurrent registrations and exits overwrite each other's records.
async function updatePersistedJobs(update: (records: PtyJobRecord[]) => void): Promise<PtyJobRecord[]> {
  if (!persistJobs) {
    const records = [...memoryRecords];
    update(records);
    memoryRecords = records;
    return records;
  }
  let updated: PtyJobRecord[] | undefined;
  try {
    return await withLock(jobsLock(), () => {
      const records = readPersistedJobsSync();
      update(records);
      updated = records;
      ensureStateDir();
      try { writeFileSync(jobsFile(), JSON.stringify(records, null, 2)); } catch {}
      return records;
    }, { staleMs: 60000 });
  } catch {
    // State dir (or HOME) may be gone (e.g. temp dir cleaned up during tests);
    // persistence is best-effort and must never surface as an unhandled error.
    // A lock-release failure can happen after the callback already ran; reusing
    // its result avoids applying the update a second time.
    if (updated) return updated;
    try {
      const records = readPersistedJobsSync();
      update(records);
      return records;
    } catch {
      return [];
    }
  }
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Strip CLAUDE* vars: a spawned claude CLI would otherwise treat itself as a
// child session and skip saving its transcript.
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^CLAUDE/i.test(key)) env[key] = value;
  }
  env.TERM = "xterm-256color";
  return env;
}

// -lic loads the profile (PATH) and interactive aliases used by web-terminal commands.
export function spawnPty(command: string, cwd: string, onData?: (data: Uint8Array) => void): PtyProc {
  return Bun.spawn(["bash", "-lic", command], {
    cwd,
    env: cleanEnv(),
    terminal: {
      cols: 120,
      rows: 40,
      data: (_terminal, data) => {
        onData?.(data);
      },
    },
  }) as PtyProc;
}

export async function registerJob(
  proc: PtyProc | Bun.Subprocess,
  log?: string,
  meta?: { cwd?: string; command?: string; background?: boolean },
): Promise<string> {
  const jobId = `pty-${++jobSeq}-${proc.pid}`;
  const record: PtyJobRecord = {
    jobId,
    pid: proc.pid,
    log,
    cwd: meta?.cwd,
    command: meta?.command,
    startedAt: Date.now(),
    background: meta?.background,
  };
  await updatePersistedJobs((records) => { records.push(record); });
  jobs.set(jobId, { proc, log });
  proc.exited
    .then((code) => {
      jobs.delete(jobId);
      void markPersistedJobExited(jobId, code ?? null);
    })
    .catch(() => {
      jobs.delete(jobId);
      void markPersistedJobExited(jobId, null);
    });
  evictStaleJobs();
  return jobId;
}

const JOB_RETENTION_MS = 60 * 60 * 1000;

async function markPersistedJobExited(jobId: string, exitCode: number | null): Promise<void> {
  await updatePersistedJobs((records) => {
    const rec = records.find((r) => r.jobId === jobId);
    if (!rec) return;
    rec.finishedAt = Date.now();
    rec.exitCode = exitCode;
  });
}

function pruneExpiredJobs(records: PtyJobRecord[]): PtyJobRecord[] {
  const now = Date.now();
  return records.filter((r) => {
    if (isPidAlive(r.pid)) return true;
    const finished = r.finishedAt ?? r.startedAt;
    return now - finished <= JOB_RETENTION_MS;
  });
}

export function getJob(jobId: string): PtyJob | undefined {
  return jobs.get(jobId);
}

export const MAX_LIVE_JOBS = 16;

export function liveJobCount(): number {
  let live = 0;
  for (const job of jobs.values()) {
    if (job.proc.exitCode === null) live++;
  }
  return live;
}

function evictStaleJobs(max = 50): void {
  if (jobs.size <= max) return;
  for (const [id, job] of jobs) {
    if (job.proc.exitCode !== null) jobs.delete(id);
    if (jobs.size <= max) break;
  }
}

export async function listJobs(): Promise<Array<PtyJobRecord & { live: boolean; status: string }>> {
  const records = await updatePersistedJobs((items) => {
    const kept = pruneExpiredJobs(items);
    items.splice(0, items.length, ...kept);
  });
  return records.map((r) => {
    const live = isPidAlive(r.pid);
    return { ...r, live, status: live ? "running" : "exited" };
  });
}

let logSeq = 0;
// Counter suffix keeps two logs created in the same millisecond distinct.
export function backgroundLogPath(): string {
  return `${tmpdir()}/use-code-cli-exec-${Date.now()}-${++logSeq}.log`;
}
