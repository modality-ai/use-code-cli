import { describe, expect, it } from "bun:test";
import { sseResponse } from "../sse";

describe("sseResponse", () => {
  it("returns a Response with SSE headers", () => {
    const req = new Request("http://localhost/x");
    const res = sseResponse(req, { payload: () => ({ ok: true }) });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");
  });

  it("accepts a payload returning a promise", async () => {
    const req = new Request("http://localhost/x");
    const res = sseResponse(req, { payload: async () => ({ n: 42 }) });
    expect(res).toBeInstanceOf(Response);
    // read a bit of the stream to ensure no throw
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(value).toBeDefined();
    reader.cancel();
  });

  it("applies minIntervalMs default without throwing", () => {
    const req = new Request("http://localhost/x");
    const res = sseResponse(req, { payload: () => "hi", minIntervalMs: 50, debounceMs: 10 });
    expect(res.status).toBe(200);
  });
});