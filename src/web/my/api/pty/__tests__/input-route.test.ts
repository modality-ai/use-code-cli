import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerJob, type PtyProc } from "../../../../../lib/pty";
import { POST } from "../input/route";

const testHome = mkdtempSync(join(tmpdir(), "pty-input-"));
const originalHome = process.env.HOME;
process.env.HOME = testHome;

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

function request(body: unknown): Request {
  return new Request("http://localhost/my/api/pty/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockProc(pid: number) {
  const written: string[] = [];
  const proc = {
    pid,
    exited: new Promise<number | null>(() => {}),
    exitCode: null,
    terminal: { write: (data: string) => { written.push(data); }, close: () => {} },
  } as unknown as PtyProc;
  return { proc, written };
}

describe("POST /my/api/pty/input", () => {
  it("rejects missing jobId or data with 400", async () => {
    const noJob = await POST(request({ data: "ls\n" }));
    expect(noJob.status).toBe(400);
    const noData = await POST(request({ jobId: "pty-1-1" }));
    expect(noData.status).toBe(400);
    const empty = await POST(request({}));
    expect(empty.status).toBe(400);
  });

  it("rejects unknown jobId with 404", async () => {
    const res = await POST(request({ jobId: "pty-999999-0", data: "x" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("writes keystrokes to the registered job's terminal", async () => {
    const { proc, written } = mockProc(31337);
    const jobId = await registerJob(proc);
    const res = await POST(request({ jobId, data: "echo hi\n" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(written).toEqual(["echo hi\n"]);
  });

  it("rejects jobs without a terminal with 400", async () => {
    const proc = {
      pid: 31338,
      exited: new Promise<number | null>(() => {}),
      exitCode: null,
    } as unknown as PtyProc;
    const jobId = await registerJob(proc);
    const res = await POST(request({ jobId, data: "x" }));
    expect(res.status).toBe(400);
  });
});
