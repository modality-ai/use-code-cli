import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLIND_CONSENT_REQUIRED, NOT_APPROVABLE } from "../../../lib/permission-prompt";
import { registerJob, type PtyProc } from "../../../lib/pty";
import type { SessionInfo } from "../../../lib/sessions";
import { approveCommand } from "../approve";

const testHome = mkdtempSync(join(tmpdir(), "approve-"));
const originalHome = process.env.HOME;
process.env.HOME = testHome;

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

function mockProc(pid: number, options: { terminal?: boolean; exited?: boolean } = {}) {
  const written: string[] = [];
  const proc = {
    pid,
    exited: new Promise<number | null>(() => {}),
    exitCode: options.exited ? 0 : null,
    ...(options.terminal === false
      ? {}
      : { terminal: { write: (data: string) => { written.push(data); }, close: () => {} } }),
  } as unknown as PtyProc;
  return { proc, written };
}

function session(pid: number, status = "waiting", waitingFor = "permission prompt"): SessionInfo {
  return {
    pid,
    sessionId: `sid-${pid}`,
    cwd: "/w/test",
    startedAt: Date.now() - 1000,
    updatedAt: Date.now(),
    online: true,
    status,
    waitingFor,
  } as SessionInfo;
}

function run(jobId: string, sessions: SessionInfo[], blind = true) {
  return approveCommand.create({ readSessions: async () => sessions })({ jobId, blind } as any);
}

describe("approve", () => {
  it("rejects an unknown jobId with 404 and the NOT APPROVABLE copy", async () => {
    const result = await run("pty-999999-999", [session(999)]);
    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_APPROVABLE);
    expect(result.data?.statusCode).toBe(404);
  });

  it("rejects an exited job without writing", async () => {
    const { proc, written } = mockProc(41001, { exited: true });
    const jobId = await registerJob(proc);
    const result = await run(jobId, [session(41001)]);
    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_APPROVABLE);
    expect(written).toEqual([]);
  });

  it("rejects a job without a terminal", async () => {
    const { proc } = mockProc(41002, { terminal: false });
    const jobId = await registerJob(proc);
    const result = await run(jobId, [session(41002)]);
    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_APPROVABLE);
  });

  it("rejects a live job whose session is not waiting", async () => {
    const { proc, written } = mockProc(41003);
    const jobId = await registerJob(proc);
    const result = await run(jobId, [session(41003, "busy", "permission prompt")]);
    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_APPROVABLE);
    expect(written).toEqual([]);
  });

  it("rejects a waiting session whose reason is not a permission prompt", async () => {
    const { proc, written } = mockProc(41004);
    const jobId = await registerJob(proc);
    const result = await run(jobId, [session(41004, "waiting", "user input")]);
    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_APPROVABLE);
    expect(written).toEqual([]);
  });

  it("refuses without explicit --blind confirmation", async () => {
    const { proc, written } = mockProc(41008);
    const jobId = await registerJob(proc);
    const result = await run(jobId, [session(41008)], false);
    expect(result.success).toBe(false);
    expect(result.message).toBe(BLIND_CONSENT_REQUIRED);
    expect(written).toEqual([]);
  });

  it("sends y\\r on a waiting, live, terminal PTY job", async () => {
    const { proc, written } = mockProc(41005);
    const jobId = await registerJob(proc);
    const result = await run(jobId, [session(41005)]);
    expect(result.success).toBe(true);
    expect(result.data?.statusCode).toBe(200);
    expect(written).toEqual(["y\r"]);
  });

  it("approves a job owned by another process through its control socket", async () => {
    const paths: string[] = [];
    const result = await approveCommand.create({
      listJobs: async () => [{ jobId: "pty-remote-1", pid: 41009, approvable: true, controlPath: "/tmp/remote.sock" }] as any,
      readSessions: async () => [session(41009)],
      writeApproval: async (path) => { paths.push(path); return true; },
    })({ jobId: "pty-remote-1", blind: true } as any);

    expect(result.success).toBe(true);
    expect(paths).toEqual(["/tmp/remote.sock"]);
  });

  it("gives the exact NOT APPROVABLE copy for a non-PTY target", async () => {
    const result = await run("external-session", [session(41006, "waiting", "permission prompt")]);
    expect(result.success).toBe(false);
    expect(result.message).toBe(NOT_APPROVABLE);
  });
});
