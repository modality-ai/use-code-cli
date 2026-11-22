import { describe, expect, it } from "bun:test";
import { cronMatchesDate, cronTime, cronWeekdays as cronDays } from "../cron";
import {
  buildSchedule,
  dateKey,
  fetchSchedule,
  parseDateKey,
  weekdayLong,
  weekdayShort,
} from "../schedule";

const now = new Date(2026, 10, 22, 12, 0);

const sessionResult = {
  success: true,
  data: [{ sessionId: "s1", name: "alpha" }],
};

const detailResult = {
  success: true,
  data: {
    crons: [
      { id: "c1", cron: "0 8 * * *", recurring: true, prompt: "Morning stretch", schedule: "Every day" },
      { id: "c2", cron: "0 10 22 11 *", recurring: false, prompt: "Call the landlord" },
      { id: "c3", cron: "0 17 * * 5", recurring: true, prompt: "Weekly review" },
    ],
    monitors: [
      { id: "m1", description: "Watch build", createdAt: new Date(2026, 10, 22, 15, 30).toISOString() },
    ],
  },
};

describe("schedule cron parsing", () => {
  it("reads the time from 5-field and 6-field expressions", () => {
    expect(cronTime("0 8 * * *")).toBe("08:00");
    expect(cronTime("30 15 22 11 *")).toBe("15:30");
    expect(cronTime("0 30 9 * * *")).toBe("09:30");
  });

  it("expands weekday lists and names", () => {
    expect(cronDays("0 17 * * 5")).toEqual([5]);
    expect(cronDays("0 17 * * 1,3,5")).toEqual([1, 3, 5]);
    expect(cronDays("0 17 * * mon-wed")).toEqual([1, 2, 3]);
    expect(cronDays("0 8 * * *")).toHaveLength(7);
  });

  it("matches month, day-of-month, and weekday restrictions", () => {
    expect(cronMatchesDate("0 10 22 11 *", now)).toBe(true);
    expect(cronMatchesDate("0 10 21 11 *", now)).toBe(false);
    expect(cronMatchesDate("0 17 * * 5", now)).toBe(false);
    expect(cronMatchesDate("0 17 * * 0", now)).toBe(true);
  });
});

describe("fetchSchedule", () => {
  it("aggregates crons and monitors into the API contract", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const execute = async (props: Record<string, unknown>) => {
      calls.push(props);
      return props.command === "sessions" ? sessionResult : detailResult;
    };

    const data = await fetchSchedule({ execute, now });

    expect(calls[0]).toEqual({ command: "sessions" });
    expect(calls[1]).toMatchObject({ command: "session", target: "s1" });
    expect(data.date).toBe("2026-11-22");
    expect(data.countToday).toBe(3);
    expect(data.items.map((item) => item.time)).toEqual(["08:00", "10:00", "15:30"]);
    expect(data.items.map((item) => item.kind)).toEqual(["routine", "once", "once"]);
    expect(data.items[0]?.cadence).toBe("Every day");
    expect(data.items[0]?.href).toBe("/my/session/s1");
    expect(data.items[0]?.completed).toBe(false);
    expect(data.routines).toHaveLength(2);
    expect(data.routines.map((routine) => routine.title)).toEqual(["Morning stretch", "Weekly review"]);
    expect(data.routines[1]?.days).toEqual([5]);
  });

  it("builds an empty schedule when no sessions are online", async () => {
    const data = await fetchSchedule({
      execute: async () => ({ success: true, data: [] }),
      now,
    });
    expect(data).toEqual({ date: "2026-11-22", countToday: 0, items: [], routines: [] });
  });

  it("keeps other sessions when one detail lookup fails", async () => {
    const execute = async (props: Record<string, unknown>) => {
      if (props.command === "sessions") {
        return { success: true, data: [{ sessionId: "bad" }, { sessionId: "good", name: "beta" }] };
      }
      if (props.target === "bad") throw new Error("offline");
      return { success: true, data: { crons: [{ id: "c9", cron: "0 9 * * *", recurring: true, prompt: "Standup" }], monitors: [] } };
    };
    const data = await fetchSchedule({ execute, now });
    expect(data.countToday).toBe(1);
    expect(data.items[0]?.sessionName).toBe("beta");
  });
});

describe("buildSchedule", () => {
  it("includes recurring routines only on their active days", () => {
    const data = buildSchedule(
      [{
        ref: { sessionId: "s2", sessionName: "gamma", href: "/my/session/s2" },
        crons: [{ id: "weekly", cron: "0 17 * * 5", recurring: true, prompt: "Weekly review" }],
        monitors: [],
      }],
      now,
    );
    expect(data.countToday).toBe(0);
    expect(data.routines).toHaveLength(1);
    expect(data.routines[0]?.cadence).toBe("Fridays");
  });
});

describe("schedule date helpers", () => {
  it("formats and parses date keys", () => {
    const d = new Date(2026, 10, 22, 12, 0);
    expect(dateKey(d)).toBe("2026-11-22");
    const parsed = parseDateKey("2026-11-22");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10);
    expect(parsed.getDate()).toBe(22);
  });

  it("returns fallback for invalid date key", () => {
    const parsed = parseDateKey("not-a-date");
    expect(parsed instanceof Date).toBe(true);
  });

  it("maps weekday names", () => {
    expect(weekdayLong(0)).toBe("Sunday");
    expect(weekdayLong(99)).toBe("Today");
    expect(weekdayShort(1)).toBe("M");
    expect(weekdayShort(99)).toBe("");
  });


});
