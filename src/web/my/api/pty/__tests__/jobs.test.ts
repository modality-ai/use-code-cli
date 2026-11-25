import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_LIVE_JOBS,
  backgroundLogPath,
  getJob,
  listJobs,
  liveJobCount,
  registerJob,
  setPtyJobPersistenceEnabled,
  type PtyProc,
} from "../../../../../lib/pty";

const testHome = mkdtempSync(join(tmpdir(), "pty-jobs-"));
const originalHome = process.env.HOME;
process.env.HOME = testHome;

beforeAll(() => {
  setPtyJobPersistenceEnabled(false);
});

afterAll(() => {
  setPtyJobPersistenceEnabled(true);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await flush();
  }
  throw new Error("condition was not met after flushing the event loop");
}

// Minimal PtyProc stand-in: only pid / exited / exitCode / terminal
// are touched by the jobs registry and its callers.
function mockProc(pid: number, opts: { exitCode?: number | null } = {}) {
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => {
    resolveExit = resolve;
  });
  const proc = {
    pid,
    exited,
    exitCode: opts.exitCode ?? null,
    terminal: {
      write: (data: string) => data,
      close: () => {},
    },
  } as unknown as PtyProc;
  return { proc, resolveExit };
}

describe("registerJob / getJob", () => {
  it("returns a pty-<seq>-<pid> jobId and registers the job", async () => {
    const { proc } = mockProc(4242);
    const jobId = await registerJob(proc);
    expect(jobId).toMatch(/^pty-\d+-4242$/);
    expect(getJob(jobId)?.proc).toBe(proc);
  });

  it("stores the background log path alongside the job", async () => {
    const { proc } = mockProc(4243);
    const jobId = await registerJob(proc, "/tmp/exec.log");
    expect(getJob(jobId)?.log).toBe("/tmp/exec.log");
  });

  it("keeps both records when registrations run concurrently", async () => {
    const a = mockProc(8001);
    const b = mockProc(8002);
    const [jobA, jobB] = await Promise.all([registerJob(a.proc), registerJob(b.proc)]);
    const ids = (await listJobs()).map((j) => j.jobId);
    expect(ids).toContain(jobA);
    expect(ids).toContain(jobB);
  });
});

describe("job eviction", () => {
  it("drops a job once its process exits", async () => {
    const { proc, resolveExit } = mockProc(4244);
    const jobId = await registerJob(proc);
    expect(getJob(jobId)).toBeDefined();
    resolveExit(0);
    await proc.exited;
    await flush();
    expect(getJob(jobId)).toBeUndefined();
  });

  it("evicts exited jobs beyond the live cap", async () => {
    // MAX_LIVE_JOBS + margin covers the eviction path without 60 registrations.
    const exited: { jobId: string; proc: PtyProc; resolveExit: (c: number | null) => void }[] = [];
    let firstJobId = "";
    for (let i = 0; i < MAX_LIVE_JOBS + 2; i++) {
      const m = mockProc(5000 + i);
      const jobId = await registerJob(m.proc);
      if (i === 0) firstJobId = jobId;
      exited.push({ jobId, proc: m.proc, resolveExit: m.resolveExit });
    }
    expect(getJob(firstJobId)).toBeDefined();
    for (const m of exited) {
      (m.proc as { exitCode: number | null }).exitCode = 0;
      m.resolveExit(0);
    }
    await Promise.all(exited.map((m) => m.proc.exited));
    const { proc: trigger } = mockProc(6000);
    await registerJob(trigger);
    expect(getJob(firstJobId)).toBeUndefined();
  });
});

describe("backgroundLogPath", () => {
  it("writes a unique log file under the OS tmpdir", () => {
    const a = backgroundLogPath();
    const b = backgroundLogPath();
    expect(a.startsWith(`${tmpdir()}/use-code-cli-exec-`)).toBe(true);
    expect(a.endsWith(".log")).toBe(true);
    expect(a).not.toBe(b); // counter suffix guards against same-ms collisions
  });
});

describe("exit persistence resilience", () => {
  it("does not surface an unhandled error when the state dir is removed before exit", async () => {
    const errors: unknown[] = [];
    const handler = (reason: unknown) => errors.push(reason);
    process.on("unhandledRejection", handler);
    const jobsFile = join(testHome, ".use-code-cli", "pty-jobs.json");
    setPtyJobPersistenceEnabled(true);
    try {
      const { proc, resolveExit } = mockProc(9001);
      await registerJob(proc);
      rmSync(testHome, { recursive: true, force: true });
      resolveExit(0);
      await proc.exited;
      await waitFor(() => existsSync(jobsFile));
      await flush();
      expect(errors).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", handler);
      setPtyJobPersistenceEnabled(false);
      mkdirSync(testHome, { recursive: true });
    }
  });
});

describe("liveJobCount", () => {
  it("counts only jobs whose process has not exited", async () => {
    const before = liveJobCount();
    const done = mockProc(7002);
    const live1 = mockProc(7001);
    const live2 = mockProc(7003);
    await registerJob(live1.proc);
    await registerJob(done.proc);
    await registerJob(live2.proc);
    done.resolveExit(0);
    await done.proc.exited;
    await flush();
    expect(liveJobCount() - before).toBe(2);
  });

  it("exposes a positive cap for the 429 gate", () => {
    expect(MAX_LIVE_JOBS).toBeGreaterThan(0);
  });
});
