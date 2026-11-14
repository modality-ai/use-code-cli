import { describe, expect, it } from "bun:test";
import { SESSION_STATUSES, sessionStatusRank } from "../status";

describe("SESSION_STATUSES", () => {
  it("accepts busy, waiting, and idle", () => {
    expect(SESSION_STATUSES).toEqual(["busy", "waiting", "idle"]);
  });
});

describe("sessionStatusRank", () => {
  it("is case-insensitive", () => {
    expect(sessionStatusRank("BUSY")).toBe(4);
    expect(sessionStatusRank("Waiting")).toBe(3);
  });

  it("ranks an empty string as unknown", () => {
    expect(sessionStatusRank("")).toBe(0);
  });
});
