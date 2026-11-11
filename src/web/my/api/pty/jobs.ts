import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Live PTY jobs: jobId -> { proc, log? }. Both foreground (streamed) and
// background (logged) jobs register here so the browser can send keystrokes
// via /my/api/pty/input. Exited jobs are evicted automatically.

// spawnPty always attaches a terminal, so narrow away the optional.
export type PtyProc = Bun.Subprocess & { terminal: NonNullable<Bun.Subprocess["terminal"]> };

export interface PtyJob {
  proc: PtyProc;
  log?: string;
}
const jobs = new Map<string, PtyJob>();
let jobSeq = 0;

// The dev server usually runs inside a Claude Code session and inherits its
// CLAUDE* env (e.g. CLAUDE_CODE_CHILD_SESSION), which makes spawned claude
// CLI instances treat themselves as child sessions and disable transcript
// saving. Strip them so the web terminal spawns independent sessions.
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^CLAUDE/i.test(key)) env[key] = value;
  }
  env.TERM = "xterm-256color";
  return env;
}

export function spawnPty(command: string, cwd: string, onData?: (data: Uint8Array) => void): PtyProc {
  // `-lic`: login shell loads profile (PATH etc.), interactive shell expands
  // aliases — so a bare `open-yolo ...` typed in the web terminal works.
  // The terminal option below always attaches a Terminal, but Bun's spawn
  // generics still type it as optional — one cast at the single spawn site.
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

export function registerJob(proc: PtyProc, log?: string): string {
  const jobId = `pty-${++jobSeq}-${proc.pid}`;
  jobs.set(jobId, { proc, log });
  proc.exited
    .then(() => jobs.delete(jobId))
    .catch(() => jobs.delete(jobId));
  evictStaleJobs();
  return jobId;
}

export function getJob(jobId: string): PtyJob | undefined {
  return jobs.get(jobId);
}

// Upper bound on simultaneously running PTY processes; each one is a real
// bash subprocess, so runaway Run clicks must fail fast instead of piling up.
export const MAX_LIVE_JOBS = 16;

export function liveJobCount(): number {
  let live = 0;
  for (const job of jobs.values()) {
    if (job.proc.exitCode === null) live++;
  }
  return live;
}

// Bounded registry: drop exited jobs beyond the cap
function evictStaleJobs(max = 50): void {
  if (jobs.size <= max) return;
  for (const [id, job] of jobs) {
    if (job.proc.exitCode !== null) jobs.delete(id);
    if (jobs.size <= max) break;
  }
}

// Timestamp alone collides for two background runs in the same millisecond;
// the counter keeps every log path unique.
let logSeq = 0;
export function backgroundLogPath(): string {
  return `${tmpdir()}/use-code-cli-exec-${Date.now()}-${++logSeq}.log`;
}
