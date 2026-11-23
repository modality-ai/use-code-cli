import { beforeEach, describe, expect, it, mock } from "bun:test";

const fixtureSessions = [
  { pid: 30078, sessionId: "ed6a79a1-0f7c-4de5-b455-ca19d4243eda", name: "alpha", online: true, cwd: "/tmp/a", status: "idle", updatedAt: 10 },
  { pid: 38240, sessionId: "ed6a79a1-0f7c-4de5-b455-ca19d4243eda", name: "beta", online: true, cwd: "/tmp/b", status: "idle", updatedAt: 20 },
  { pid: 40000, sessionId: "offline-session", name: "gamma", online: false, cwd: "/tmp/c", status: "idle", updatedAt: 5 },
];

const calls: any[] = [];
let readSessionsImpl = async (_includeOffline?: boolean) => fixtureSessions;
let aiToolImpl: (props: any) => Promise<any>;

function resetAiTool() {
  aiToolImpl = async (props: any) => {
    calls.push(props);
    return { success: true, data: { pid: 38240, name: "beta", sessionId: "ed6a79a1-0f7c-4de5-b455-ca19d4243eda" } };
  };
}
resetAiTool();

mock.module("../../../../../../lib/sessions", () => ({
  readSessions: (includeOffline?: boolean) => readSessionsImpl(includeOffline),
  findOfflineTranscriptPath: async () => null,
  findSessionsFuzzy: (sessions: any[], target: string) => {
    const exact = sessions.filter((s) => s.name === target || s.sessionId === target);
    if (exact.length > 0) return exact;
    return sessions.filter((s) => (s.name ?? "").startsWith(target));
  },
}));

mock.module("../../../../../../scripts/index", () => ({
  aiTool: {
    execute: async (props: any) => aiToolImpl(props),
  },
}));

const { POST } = await import("../route");

describe("POST /my/api/session/stop", () => {
  beforeEach(() => {
    calls.length = 0;
    readSessionsImpl = async () => fixtureSessions;
    resetAiTool();
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no session matches", async () => {
    readSessionsImpl = async () => [];
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "zzz" }),
    }));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the selected session is offline", async () => {
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "gamma" }),
    }));
    expect(res.status).toBe(409);
  });

  it("uses the selected pid as target when sessionIds collide", async () => {
    const shared = "ed6a79a1-0f7c-4de5-b455-ca19d4243eda";
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: shared }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(calls[0].target).toBe("38240");
    expect(body.pid).toBe(38240);
    expect(body.sessionId).toBe("ed6a79a1-0f7c-4de5-b455-ca19d4243eda");
  });

  it("returns 409 when aiTool throws 'no such process'", async () => {
    aiToolImpl = async () => { throw new Error("no such process"); };
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "beta" }),
    }));
    expect(res.status).toBe(409);
  });

  it("returns 409 when the target pid exits before the CLI resolves it", async () => {
    aiToolImpl = async () => ({ success: false, message: `No session matches "38240". Try: use-code-cli sessions --all` });
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "beta" }),
    }));
    expect(res.status).toBe(409);
  });

  it("returns 404 when aiTool returns not found", async () => {
    aiToolImpl = async () => ({ success: false, message: "session not found" });
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "beta" }),
    }));
    expect(res.status).toBe(404);
  });

  it("returns 409 when aiTool reports already stopped", async () => {
    aiToolImpl = async () => ({ success: false, message: "already stopped" });
    const res = await POST(new Request("http://localhost/my/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "beta" }),
    }));
    expect(res.status).toBe(409);
  });
});
