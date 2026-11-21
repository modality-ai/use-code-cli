import { describe, expect, it } from "bun:test";
import { nextRun, discoverTaskModules } from "../scheduler";

describe("scheduler nextRun", () => {
  it("returns a future date for a valid cron", () => {
    const d = nextRun("* * * * *");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBeGreaterThan(Date.now() - 1000);
  });
  it("returns null for invalid cron", () => {
    expect(nextRun("not a cron")).toBeNull();
  });
});

describe("scheduler discoverTaskModules", () => {
  it("returns an array of .ts paths", () => {
    const files = discoverTaskModules();
    expect(Array.isArray(files)).toBe(true);
    expect(files.some((f) => f.endsWith("auto-connect.ts"))).toBe(true);
  });
});