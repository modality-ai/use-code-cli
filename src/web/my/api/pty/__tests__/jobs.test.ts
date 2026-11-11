import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import {
  MAX_LIVE_JOBS,
  backgroundLogPath,
  getJob,
  liveJobCount,
  registerJob,
  type PtyProc,
} from "../jobs";

// Minimal PtyProc stand-in: only pid / exited / exitCode / terminal
// are touched by the jobs registry and its callers.
function mockProc(pid: number, opts: { exitCode?: number | null } = {}) {
  let resolveExit: (code: number | null) => void = () => {};
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
  it("returns a pty-<seq>-<pid> jobId and registers the job", () => {
    const { proc } = mockProc(4242);
    const jobId = registerJob(proc);
    expect(jobId).toMatch(/^pty-\d+-4242$/);
    expect(getJob(jobId)?.proc).toBe(proc);
  });

  it("stores the background log path alongside the job", () => {
    const { proc } = mockProc(4243);
    const jobId = registerJob(proc, "/tmp/exec.log");
    expect(getJob(jobId)?.log).toBe("/tmp/exec.log");
  });
});

describe("job eviction", () => {
  it("drops a job once its process exits", async () => {
    const { proc, resolveExit } = mockProc(4244);
    const jobId = registerJob(proc);
    expect(getJob(jobId)).toBeDefined();
    resolveExit(0);
    await proc.exited;
    await new Promise((r) => setTimeout(r, 0));
    expect(getJob(jobId)).toBeUndefined();
  });

  it("evicts exited jobs beyond the cap of 50 live entries", async () => {
    const exited: { jobId: string; proc: PtyProc; resolveExit: (c: number | null) => void }[] = [];
    let firstJobId = "";
    for (let i = 0; i < 60; i++) {
      const m = mockProc(5000 + i);
      const jobId = registerJob(m.proc);
      if (i === 0) firstJobId = jobId;
      exited.push({ jobId, proc: m.proc, resolveExit: m.resolveExit });
    }
    // Nothing has exited yet: all 60 stay registered.
    expect(getJob(firstJobId)).toBeDefined();
    for (const m of exited) m.resolveExit(0);
    await Promise.all(exited.map((m) => m.proc.exited));
    // Trigger eviction with one more registration.
    const { proc: trigger } = mockProc(6000);
    registerJob(trigger);
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

describe("liveJobCount", () => {
  it("counts only jobs whose process has not exited", async () => {
    const before = liveJobCount();
    const done = mockProc(7002);
    const live1 = mockProc(7001);
    const live2 = mockProc(7003);
    registerJob(live1.proc);
    registerJob(done.proc);
    registerJob(live2.proc);
    done.resolveExit(0);
    await done.proc.exited;
    await new Promise((r) => setTimeout(r, 0));
    expect(liveJobCount() - before).toBe(2);
  });

  it("exposes a positive cap for the 429 gate", () => {
    expect(MAX_LIVE_JOBS).toBeGreaterThan(0);
  });
});
