import { describe, expect, it } from "bun:test";
import { cronSummary, cronTime, cronWeekdays, isCronValid, nextCronRuns, normalizeCron, splitCron, timeCron } from "../cron";

const now = new Date(2026, 10, 22, 12, 0);

describe("cron helpers", () => {
  it("splits and normalizes 5-field and 6-field rules", () => {
    expect(splitCron("30 7 * * 1-5")).toEqual({ minute: "30", hour: "7", day: "*", month: "*", weekday: "1-5" });
    expect(normalizeCron("0 30 9 * * *")).toBe("30 9 * * *");
  });

  it("summarizes daily, weekly, and named weekday rules", () => {
    expect(cronSummary("0 8 * * *")).toBe("At 08:00, every day");
    expect(cronSummary("0 18 * * 1,3,5")).toBe("At 18:00, Mon, Wed, Fri");
    expect(cronSummary("30 7 * * 1-5")).toBe("At 07:30, Monday to Friday");
    expect(cronSummary("0 9 * * mon-wed")).toBe("At 09:00, Monday to Wednesday");
  });

  it("derives time and weekdays for display", () => {
    expect(cronTime("30 7 * * 1-5")).toBe("07:30");
    expect(cronTime("*/5 * * * *")).toBe("--:--");
    expect(cronWeekdays("0 18 * * 1,3,5")).toEqual([1, 3, 5]);
    expect(cronWeekdays("* * * * *")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("computes the next three daily runs", () => {
    const runs = nextCronRuns("0 8 * * *", now, 3);
    expect(runs.map((date) => `${date.getDay()} ${date.getDate()} ${date.getHours()}:${date.getMinutes()}`)).toEqual([
      "1 23 8:0",
      "2 24 8:0",
      "3 25 8:0",
    ]);
  });

  it("respects an inclusive upper bound", () => {
    const until = new Date(2026, 10, 23, 23, 59, 59, 999);
    const runs = nextCronRuns("0 8 * * *", now, 3, until);
    expect(runs.map((date) => `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes()}`)).toEqual([
      "11/23 8:0",
    ]);
  });

  it("computes weekday-restricted and named-day runs", () => {
    const weekdayRuns = nextCronRuns("30 7 * * 1-5", now, 2);
    expect(weekdayRuns.map((date) => `${date.getDay()} ${date.getDate()} ${date.getHours()}:${date.getMinutes()}`)).toEqual([
      "1 23 7:30",
      "2 24 7:30",
    ]);
    const namedRuns = nextCronRuns("0 18 * * mon,wed,fri", now, 3);
    expect(namedRuns.map((date) => date.getDay())).toEqual([1, 3, 5]);
  });
});

describe("cron validity and timeCron", () => {
  it("validates well-formed rules and rejects too few fields", () => {
    expect(isCronValid("0 8 * * *")).toBe(true);
    expect(isCronValid("0 8 * *")).toBe(false);
    expect(isCronValid("* * * * *")).toBe(true);
  });

  it("builds a cron expression from a HH:MM time", () => {
    expect(timeCron("07:30")).toBe("30 7 * * *");
    expect(timeCron("07:30", [1, 3, 5])).toBe("30 7 * * 1,3,5");
  });
});
