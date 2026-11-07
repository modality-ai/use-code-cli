import { describe, expect, it } from "bun:test";
import { sessionStatusRank, pickBestSession } from "../session-data";

describe("sessionStatusRank", () => {
  it("ranks statuses", () => {
    expect(sessionStatusRank("busy")).toBe(4);
    expect(sessionStatusRank("active")).toBe(3);
    expect(sessionStatusRank("idle")).toBe(2);
    expect(sessionStatusRank("shell")).toBe(1);
    expect(sessionStatusRank(undefined)).toBe(0);
    expect(sessionStatusRank("other")).toBe(0);
  });
});

describe("pickBestSession", () => {
  it("returns null for empty", () => {
    expect(pickBestSession([])).toBeNull();
  });
  it("returns single", () => {
    const s = { sessionId: "a", pid: 1, online: true, status: "idle", updatedAt: 5 } as any;
    expect(pickBestSession([s])).toBe(s);
  });
  it("prefers online", () => {
    const off = { sessionId: "off", pid: 0, online: false, status: "busy", updatedAt: 100 } as any;
    const on = { sessionId: "on", pid: 2, online: true, status: "idle", updatedAt: 1 } as any;
    expect(pickBestSession([off, on])?.sessionId).toBe("on");
  });
  it("prefers busy over active", () => {
    const a = { sessionId: "a", pid: 1, online: true, status: "active", updatedAt: 1 } as any;
    const b = { sessionId: "b", pid: 2, online: true, status: "busy", updatedAt: 1 } as any;
    expect(pickBestSession([a, b])?.sessionId).toBe("b");
  });
  it("ties broken by updatedAt", () => {
    const a = { sessionId: "a", pid: 1, online: true, status: "idle", updatedAt: 5 } as any;
    const b = { sessionId: "b", pid: 2, online: true, status: "idle", updatedAt: 10 } as any;
    expect(pickBestSession([a, b])?.sessionId).toBe("b");
  });
});
