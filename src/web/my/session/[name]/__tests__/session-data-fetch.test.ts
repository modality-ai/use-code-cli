import { describe, expect, it, mock } from "bun:test";

const actual = await import("../../../../../lib/sessions");

const mockedSessions = [
  { name: "alpha", sessionId: "sid-1", online: true, status: "waiting", waitingFor: "permission prompt", stopped: true, updatedAt: 1 },
];

mock.module("../../../../../lib/sessions", () => ({
  ...actual,
  readSessions: async () => mockedSessions,
  findSessionsFuzzy: () => mockedSessions,
}));

const { fetchSessionData } = await import("../session-data");

describe("fetchSessionData", () => {
  it("passes waitingFor through the status-only path", async () => {
    const res = await fetchSessionData("alpha", { includeEntries: false });
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe("waiting");
    expect(res.data?.waitingFor).toBe("permission prompt");
    expect(res.data?.stopped).toBe(true);
  });
});
