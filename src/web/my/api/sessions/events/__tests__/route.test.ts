import { describe, expect, it, mock } from "bun:test";

const mockedSessions = [
  { name: "alpha", sessionId: "sid-1", hero: "JAMES", status: "busy", lastPrompt: "hello" },
];

mock.module("../../../../../../lib/live", () => ({
  fetchSessions: async () => mockedSessions,
}));

const { GET } = await import("../route");

describe("sessions events route", () => {
  it("returns an SSE Response with SSE headers", async () => {
    const req = new Request("http://localhost/my/api/sessions/events");
    const res = await GET(req);
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    expect(res.status).toBe(200);
  });

  it("pushes an initial snapshot containing the fetched sessions", async () => {
    const req = new Request("http://localhost/my/api/sessions/events");
    const res = await GET(req);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data: ");
    expect(text).toContain("sid-1");
    expect(text).toContain("alpha");
    reader.cancel();
  });
});
