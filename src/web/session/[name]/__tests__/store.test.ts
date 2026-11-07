import { describe, expect, it } from "bun:test";
import { onlineEmoji, reducer, statusEmoji, STATUS_EMOJI } from "../store";
import type { SessionState } from "../store";

describe("reducer", () => {
  it("returns initial state when no changes", () => {
    const state: SessionState = { name: "", online: false, status: "idle" };
    expect(reducer(state, {})).toEqual(state);
  });

  it("merges partial state", () => {
    const state: SessionState = { name: "s1", online: false, status: "idle" };
    expect(reducer(state, { online: true })).toEqual({ name: "s1", online: true, status: "idle" });
  });

  it("updates status", () => {
    const state: SessionState = { name: "s1", online: true, status: "idle" };
    expect(reducer(state, { status: "busy" })).toEqual({ name: "s1", online: true, status: "busy" });
  });

  it("updates name", () => {
    const state: SessionState = { name: "", online: false, status: "idle" };
    expect(reducer(state, { name: "abc" })).toEqual({ name: "abc", online: false, status: "idle" });
  });

  it("does not mutate original state", () => {
    const state: SessionState = { name: "s1", online: false, status: "idle" };
    const next = reducer(state, { online: true });
    expect(state.online).toBe(false);
    expect(next).not.toBe(state);
  });

  it("ignores type field", () => {
    const state: SessionState = { name: "s1", online: false, status: "idle" };
    expect(reducer(state, { type: "SET", online: true } as any)).toEqual({ name: "s1", online: true, status: "idle" });
  });

  it("handles null/undefined action gracefully", () => {
    const state: SessionState = { name: "s1", online: false, status: "idle" };
    expect(reducer(state, null as any)).toEqual(state);
  });
});

describe("statusEmoji", () => {
  it("maps idle", () => {
    expect(statusEmoji("idle")).toBe("💤");
  });
  it("maps busy", () => {
    expect(statusEmoji("busy")).toBe("💻");
  });
  it("maps active", () => {
    expect(statusEmoji("active")).toBe("🟢");
  });
  it("falls back for unknown", () => {
    expect(statusEmoji("foo")).toBe("⚪");
  });
});

describe("onlineEmoji", () => {
  it("online true", () => {
    expect(onlineEmoji(true)).toBe("🟢");
  });
  it("online false", () => {
    expect(onlineEmoji(false)).toBe("🔴");
  });
});

describe("STATUS_EMOJI", () => {
  it("has three entries", () => {
    expect(Object.keys(STATUS_EMOJI).length).toBe(3);
  });
});