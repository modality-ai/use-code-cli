import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "./file-lock";

// Live PTY jobs: jobId -> { proc, log? }. Both foreground (streamed) and
// background (logged) jobs register here so the browser can send keystrokes
// via /my/api/pty/input. Exited jobs are evicted automatically.

export type PtyProc = Bun.Subprocess & { terminal: NonNullable<Bun.Subprocess["terminal"]> };

interface ControlSocket {
  server: Server;
  path: string;
}

interface PtyJob {
  proc: Bun.Subprocess;
  log?: string;
  control?: ControlSocket;
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
  spawnMode?: "fast" | "shell";
  controlPath?: string;
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

// Registrations and exits often arrive in bursts. Coalesce their state updates
// into one locked read-modify-write instead of one disk write per event.
const PERSIST_FLUSH_MS = 50;
type PersistedUpdate = (records: PtyJobRecord[]) => void;
let pendingUpdates: PersistedUpdate[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushChain: Promise<void> = Promise.resolve();

function schedulePersistFlush(): void {
  if (flushTimer || pendingUpdates.length === 0) return;
  flushTimer = setTimeout(() => { void flushPersistedUpdates(); }, PERSIST_FLUSH_MS);
}

function queuePersistedUpdate(update: PersistedUpdate): void {
  if (!persistJobs) {
    const records = [...memoryRecords];
    update(records);
    memoryRecords = records;
    return;
  }
  pendingUpdates.push(update);
  schedulePersistFlush();
}

// Serialized so concurrent forced flushes cannot interleave two lock holders.
function flushPersistedUpdates(): Promise<void> {
  if (flushTimer !== undefined) { clearTimeout(flushTimer); flushTimer = undefined; }
  const run = flushChain.then(async () => {
    if (pendingUpdates.length === 0) return;
    const updates = pendingUpdates;
    pendingUpdates = [];
    await updatePersistedJobs((records) => {
      for (const apply of updates) apply(records);
    });
  });
  flushChain = run.catch(() => {});
  return run;
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Strip CLAUDE* vars: a spawned claude CLI would otherwise treat itself as a
// child session and skip saving its transcript.
function stripClaudeVars(env: Record<string, string | undefined>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !/^CLAUDE/i.test(key)) clean[key] = value;
  }
  return clean;
}

export function cleanEnv(): Record<string, string> {
  const env = stripClaudeVars(process.env);
  env.TERM = "xterm-256color";
  return env;
}

interface SpawnPtyOptions {
  fast?: boolean;
  argv?: string[];
  env?: Record<string, string>;
  batchOutput?: boolean;
}

// -lic loads the profile (PATH) and interactive aliases used by web-terminal commands.
// Fast mode trusts the caller with argv/env and skips that shell startup.
export function spawnPty(command: string, cwd: string, onData?: (data: Uint8Array) => void, opts?: SpawnPtyOptions): PtyProc {
  const argv = opts?.fast ? opts.argv : ["bash", "-lic", command];
  if (!argv || argv.length === 0) {
    throw new Error("spawnPty: fast mode requires a non-empty argv");
  }
  const env = opts?.fast ? stripClaudeVars({ ...cleanEnv(), ...opts.env }) : cleanEnv();
  const batchOutput = opts?.batchOutput !== false;
  let pending: Uint8Array[] = [];
  let batchScheduled = false;

  function flushOutput(): void {
    batchScheduled = false;
    if (pending.length === 0) return;
    const chunks = pending;
    pending = [];
    if (chunks.length === 1) {
      const [only] = chunks;
      if (only) onData?.(only);
      return;
    }
    let size = 0;
    for (const chunk of chunks) size += chunk.length;
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    onData?.(merged);
  }

  const proc = Bun.spawn(argv, {
    cwd,
    env,
    terminal: {
      cols: 120,
      rows: 40,
      data: (_terminal, data) => {
        if (!onData) return;
        if (!batchOutput) {
          onData(data);
          return;
        }
        pending.push(data);
        if (batchScheduled) return;
        batchScheduled = true;
        // PTY chunks arrive one per I/O tick; a bare microtask would flush
        // each one. Gather the tick's chunks first, then flush in a microtask.
        setTimeout(() => queueMicrotask(flushOutput), 0);
      },
    },
  }) as PtyProc;
  if (batchOutput) void proc.exited.then(flushOutput, flushOutput);
  return proc;
}

function closeControlSocket(control: ControlSocket | undefined): void {
  if (!control) return;
  try { control.server.close(); } catch {}
  try { unlinkSync(control.path); } catch {}
}

// A persisted job record cannot carry a subprocess handle across CLI processes.
// This socket lets a later process deliver the approval keystroke to the owner.
async function startControlSocket(jobId: string, proc: PtyProc | Bun.Subprocess): Promise<ControlSocket | undefined> {
  if (!proc.terminal) return undefined;
  const dir = join(stateDir(), "pty-control");
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${jobId}.sock`);
    try { unlinkSync(path); } catch {}
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      let input = "";
      socket.on("data", (chunk) => {
        input += chunk;
        if (input.length > 8) socket.destroy();
      });
      socket.on("end", () => {
        if (input !== "y\r" || proc.exitCode !== null || !proc.terminal) {
          socket.end("err");
          return;
        }
        try {
          proc.terminal.write(input);
          socket.end("ok");
        } catch {
          socket.end("err");
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    });
    try { chmodSync(path, 0o600); } catch {}
    server.unref();
    return { server, path };
  } catch {
    return undefined;
  }
}

export async function writeJobApproval(controlPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(controlPath);
    let settled = false;
    let reply = "";
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 2000);
    socket.setEncoding("utf8");
    socket.on("connect", () => { socket.end("y\r"); });
    socket.on("data", (chunk) => { reply += chunk; });
    socket.on("end", () => finish(reply.includes("ok")));
    socket.on("error", () => finish(false));
  });
}

export async function registerJob(
  proc: PtyProc | Bun.Subprocess,
  log?: string,
  meta?: { cwd?: string; command?: string; background?: boolean; spawnMode?: "fast" | "shell" },
): Promise<string> {
  const jobId = `pty-${++jobSeq}-${proc.pid}`;
  const control = await startControlSocket(jobId, proc);
  const record: PtyJobRecord = {
    jobId,
    pid: proc.pid,
    log,
    cwd: meta?.cwd,
    command: meta?.command,
    startedAt: Date.now(),
    background: meta?.background,
    spawnMode: meta?.spawnMode,
    controlPath: control?.path,
  };
  queuePersistedUpdate((records) => { records.push(record); });
  jobs.set(jobId, { proc, log, control });
  const finish = (code: number | null) => {
    jobs.delete(jobId);
    closeControlSocket(control);
    void markPersistedJobExited(jobId, code);
  };
  proc.exited.then((code) => finish(code ?? null), () => finish(null));
  evictStaleJobs();
  return jobId;
}

const JOB_RETENTION_MS = 60 * 60 * 1000;

async function markPersistedJobExited(jobId: string, exitCode: number | null): Promise<void> {
  queuePersistedUpdate((records) => {
    const rec = records.find((r) => r.jobId === jobId);
    if (!rec) return;
    rec.finishedAt = Date.now();
    rec.exitCode = exitCode;
  });
  // A process exit is a durability boundary: land pending writes now, and
  // batch with any other exits resolved in the same tick.
  await flushPersistedUpdates();
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
    if (job.proc.exitCode !== null) {
      jobs.delete(id);
      closeControlSocket(job.control);
    }
    if (jobs.size <= max) break;
  }
}

export async function listJobs(): Promise<Array<PtyJobRecord & { live: boolean; status: string; approvable: boolean }>> {
  await flushPersistedUpdates();
  const records = await updatePersistedJobs((items) => {
    const kept = pruneExpiredJobs(items);
    items.splice(0, items.length, ...kept);
  });
  return records.map((r) => {
    const live = isPidAlive(r.pid);
    return {
      ...r,
      live,
      status: live ? "running" : "exited",
      approvable: r.finishedAt === undefined && r.controlPath !== undefined && existsSync(r.controlPath),
    };
  });
}

let logSeq = 0;
// Counter suffix keeps two logs created in the same millisecond distinct.
export function backgroundLogPath(): string {
  return `${tmpdir()}/use-code-cli-exec-${Date.now()}-${++logSeq}.log`;
}
