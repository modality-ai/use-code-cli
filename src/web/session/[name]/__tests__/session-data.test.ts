import { describe, expect, it } from "bun:test";
import { sessionStatusRank, pickBestSession, stripToolResults, findToolById } from "../session-data";

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


describe("stripToolResults", () => {
  it("removes input/result/resultHtml from every tool", () => {
    const entries = [
      { tools: [{ id: "t1", name: "bash", input: { cmd: "ls" }, result: "out", resultHtml: "<p>out</p>" }] },
    ];
    stripToolResults(entries);
    expect(entries[0].tools[0].input).toBeUndefined();
    expect(entries[0].tools[0].result).toBeUndefined();
    expect(entries[0].tools[0].resultHtml).toBeUndefined();
    expect(entries[0].tools[0].id).toBe("t1");
  });

  it("is a no-op when there are no tools", () => {
    const entries = [{ text: "hi" }, { tools: null }];
    expect(() => stripToolResults(entries)).not.toThrow();
  });

  it("handles empty entries array", () => {
    expect(() => stripToolResults([])).not.toThrow();
  });
});

describe("findToolById", () => {
  it("returns the tool data when id matches", () => {
    const entries = [
      { tools: [{ id: "t1", name: "bash", input: { cmd: "ls" }, result: "out", resultHtml: "<p>out</p>" }] },
    ];
    expect(findToolById(entries, "t1")).toEqual({ input: { cmd: "ls" }, result: "out", resultHtml: "<p>out</p>" });
  });

  it("returns undefined when id does not match", () => {
    const entries = [{ tools: [{ id: "t1", name: "bash" }] }];
    expect(findToolById(entries, "nope")).toBeUndefined();
  });

  it("searches across multiple entries", () => {
    const entries = [
      { tools: [{ id: "a", name: "x" }] },
      { tools: [{ id: "b", name: "y", result: "found" }] },
    ];
    expect(findToolById(entries, "b")?.result).toBe("found");
  });

  it("returns undefined for empty entries", () => {
    expect(findToolById([], "t1")).toBeUndefined();
  });
});
