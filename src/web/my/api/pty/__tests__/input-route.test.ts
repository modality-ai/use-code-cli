import { describe, expect, it } from "bun:test";
import { registerJob, type PtyProc } from "../jobs";
import { POST } from "../input/route";

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
    const jobId = registerJob(proc);
    const res = await POST(request({ jobId, data: "echo hi\n" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(written).toEqual(["echo hi\n"]);
  });
});
