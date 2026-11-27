import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  listJobs,
  registerJob,
  setPtyJobPersistenceEnabled,
  type PtyProc,
} from "../pty";

function fakeProc(pid: number, onExit: (resolve: (code: number) => void) => void): PtyProc {
  return {
    pid,
    exitCode: null,
    exited: new Promise<number>((resolve) => onExit(resolve)),
  } as unknown as PtyProc;
}

describe("pty in-memory persistence (test-only bypass)", () => {
  let previous = true;

  beforeEach(() => {
    previous = setPtyJobPersistenceEnabled(false);
  });

  afterEach(() => {
    setPtyJobPersistenceEnabled(previous);
  });

  it("disabling persistence keeps jobs in memory until they exit", async () => {
    let resolveExited!: (code: number) => void;
    const proc = fakeProc(999999, (resolve) => { resolveExited = resolve; });
    const jobId = await registerJob(proc, "/tmp/log", { cwd: "/tmp", command: "echo hi", background: true });
    expect(jobId).toContain("pty-");
    expect((await listJobs()).map((job) => job.jobId)).toContain(jobId);

    resolveExited(0);
    await Bun.sleep(10);
    const exitedJob = (await listJobs()).find((job) => job.jobId === jobId);
    expect(exitedJob?.exitCode).toBe(0);
  });

  it("re-enabling clears in-memory records", async () => {
    let resolveExited!: (code: number) => void;
    const proc = fakeProc(999998, (resolve) => { resolveExited = resolve; });
    const jobId = await registerJob(proc);
    resolveExited(0);

    setPtyJobPersistenceEnabled(true);
    expect((await listJobs()).map((job) => job.jobId)).not.toContain(jobId);
  });

  it("records the spawn mode in the job record", async () => {
    let resolveExited!: (code: number) => void;
    const proc = fakeProc(999997, (resolve) => { resolveExited = resolve; });
    const jobId = await registerJob(proc, undefined, { cwd: "/tmp", command: "true", spawnMode: "fast" });
    resolveExited(0);

    const job = (await listJobs()).find((item) => item.jobId === jobId);
    expect(job?.spawnMode).toBe("fast");
  });
});
