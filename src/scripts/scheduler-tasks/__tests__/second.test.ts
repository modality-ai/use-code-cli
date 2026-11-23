import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as second from "../second";

describe("second parseSchedule", () => {
  it("validates 5- and 6-field cron expressions", () => {
    const five = second.parseSchedule("* * * * *");
    expect(five?.valid).toBe(true);
    expect(five?.sixStar).toBe(false);
    expect(five?.fields.length).toBe(5);

    const six = second.parseSchedule("* * * * * *");
    expect(six?.valid).toBe(true);
    expect(six?.sixStar).toBe(true);
    expect(six?.fields.length).toBe(6);
  });

  it("rejects non-string and wrong field counts", () => {
    expect(second.parseSchedule(42)).toBeNull();
    expect(second.parseSchedule("* * *").valid).toBe(false);
    expect(second.parseSchedule("* * * * * * *").valid).toBe(false);
  });
});

describe("second scan", () => {
  it("returns loaded modules without mutating global modules", async () => {
    const before = second.modules.length;
    const loaded = await second.scan(join(import.meta.dir, "fixture"));
    expect(Array.isArray(loaded)).toBe(true);
    expect(second.modules.length).toBe(before);
  });
});

describe("second run", () => {
  it("re-runs without accumulating (restartable)", async () => {
    const dir = join(import.meta.dir, "fixture");
    const g = globalThis as { __secondIntervals?: unknown[] };

    const r1 = await second.run(dir);
    expect(r1.armed).toBe(true);
    expect(Array.isArray(g.__secondIntervals)).toBe(true);
    expect(g.__secondIntervals?.length).toBe(1);

    const r2 = await second.run(dir);
    expect(r2.armed).toBe(true);
    expect(g.__secondIntervals?.length).toBe(1);

    second.stopSecondScheduler();
    expect(g.__secondIntervals?.length).toBe(0);
  });
});
