import { afterAll, describe, expect, it } from "bun:test";
import { bunMockModule } from "modality-bun-kit";

type ToolResult = {
  success?: boolean;
  message?: string;
  data?: {
    cwd?: string;
    jobId?: string;
    pid?: number;
    log?: string;
    background?: boolean;
    stream?: ReadableStream<Uint8Array>;
    statusCode?: number;
  };
};

let mockResult: ToolResult = { success: true, message: "out\n[exit code: 0]\n", data: { cwd: "/tmp/proj", jobId: "job-1" } };
const calls: Record<string, unknown>[] = [];

const resetScripts = await bunMockModule("../../../../../../scripts/index", () => ({
  aiTool: {
    execute: async (props: Record<string, unknown>) => {
      calls.push(props);
      return mockResult;
    },
  },
}), import.meta.dir);

const { POST } = await import("../exec/route");

afterAll(() => resetScripts());

function request(body: unknown): Request {
  return new Request("http://localhost/my/api/project/proj/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /my/api/project/[name]/exec (delegated)", () => {
  it("Run calls project-run-stream and maps stream to text/plain", async () => {
    calls.length = 0;
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode("out\n"));
        controller.enqueue(enc.encode("[exit code: 0]\n"));
        controller.close();
      },
    });
    mockResult = { success: true, message: "started", data: { cwd: "/tmp/proj", jobId: "job-1", stream } };
    const res = await POST(request({ name: "proj", command: "echo hi", background: false }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-cwd")).toBe(encodeURIComponent("/tmp/proj"));
    expect(res.headers.get("x-job-id")).toBe("job-1");
    const text = await res.text();
    expect(text).toContain("[exit code: 0]");
    expect(calls[0]).toEqual({ command: "project-run-stream", project: "proj", cmd: "echo hi", detach: false });
  });

  it("Run in background calls project-run with detach true and maps JSON", async () => {
    calls.length = 0;
    mockResult = {
      success: true,
      background: true,
      data: { cwd: "/tmp/proj", background: true, jobId: "job-2", pid: 123, log: "/tmp/log" },
    };
    const res = await POST(request({ name: "proj", command: "sleep 2", background: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.background).toBe(true);
    expect(body.cwd).toBe("/tmp/proj");
    expect(body.jobId).toBe("job-2");
    expect(body.pid).toBe(123);
    expect(body.log).toBe("/tmp/log");
    expect(calls[0]).toEqual({ command: "project-run", project: "proj", cmd: "sleep 2", detach: true, keepAlive: true });
  });

  it("maps too many live jobs to 429", async () => {
    mockResult = { success: false, message: "too many live jobs; wait for one to finish" };
    const res = await POST(request({ name: "proj", command: "echo hi" }));
    expect(res.status).toBe(429);
  });

  it("maps project not found to 404", async () => {
    mockResult = { success: false, message: 'No project matches "proj".' };
    const res = await POST(request({ name: "proj", command: "echo hi" }));
    expect(res.status).toBe(404);
  });

  it("maps missing fields to 400", async () => {
    const res1 = await POST(request({ command: "echo hi" }));
    expect(res1.status).toBe(400);
    const res2 = await POST(request({ name: "proj" }));
    expect(res2.status).toBe(400);
  });

  it("emits an early chunk before the command exits", async () => {
    calls.length = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode("START\n"));
        setTimeout(() => {
          controller.enqueue(enc.encode("DONE\n[exit code: 0]\n"));
          controller.close();
        }, 50);
      },
    });
    mockResult = { success: true, message: "started", data: { cwd: "/tmp/proj", jobId: "job-3", stream } };
    const res = await POST(request({ name: "proj", command: "echo START; sleep 5; echo DONE", background: false }));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toBe("START\n");
    await reader.cancel();
  });

  it("prefers a structured statusCode from the command result", async () => {
    mockResult = { success: false, message: "boom", data: { statusCode: 409 } };
    const res = await POST(request({ name: "proj", command: "echo hi" }));
    expect(res.status).toBe(409);
  });

  it("maps generic failure to 500", async () => {
    mockResult = { success: false, message: "boom" };
    const res = await POST(request({ name: "proj", command: "echo hi" }));
    expect(res.status).toBe(500);
  });
});
