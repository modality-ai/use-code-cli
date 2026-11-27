import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import "reshow-unit";
import { clearScheduleStorage } from "./helpers";
import {
  addDays,
  headerDate,
  longDate,
  parseDate,
  shortDate,
  todayKey,
  weekOf,
} from "../../../../lib/schedule-date";
import {
  applyLocalAdds,
  emptySchedule,
  readLocalAdds,
  setScheduleNotice,
  sortItems,
  takeScheduleNotice,
  writeLocalAdd,
  type ScheduleItem,
  type ScheduleSaved,
} from "../schedule-model";

beforeEach(clearScheduleStorage);
afterEach(clearScheduleStorage);

const mkItem = (id: string, time = "09:00"): ScheduleItem => ({
  id, sessionId: "s", sessionName: "n", title: id, time,
  kind: "once", cadence: "Today only", days: [0], completed: false, href: "/",
});

describe("schedule-model date helpers", () => {
  it("parses a valid YYYY-MM-DD key into a noon date", () => {
    const d = parseDate("2026-11-22");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(12);
  });

  it("falls back to now for an invalid key", () => {
    const before = Date.now();
    const d = parseDate("not-a-date");
    expect(d.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("formats header/long/short dates from a key", () => {
    expect(headerDate("2026-11-22")).toBe("Sunday, 22 Nov");
    expect(longDate("2026-11-22")).toBe("Sunday, 22 November");
    expect(shortDate("2026-11-22")).toBe("Nov 22");
  });

  it("adds days to a date key", () => {
    expect(addDays("2026-11-22", 1)).toBe("2026-11-23");
    expect(addDays("2026-11-30", 2)).toBe("2026-12-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("returns a 7-day week starting Sunday", () => {
    const week = weekOf("2026-11-22");
    expect(week.length).toBe(7);
    expect(week[0].getDate()).toBe(22);
    expect(week[6].getDate()).toBe(28);
  });

  it("builds an empty schedule", () => {
    expect(emptySchedule("2026-11-22")).toEqual({ date: "2026-11-22", countToday: 0, items: [], routines: [] });
  });

  it("todayKey returns YYYY-MM-DD", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("schedule-model sortItems", () => {
  it("sorts items by time", () => {
    const items = [
      { time: "10:00" },
      { time: "08:00" },
      { time: "09:30" },
    ] as ScheduleItem[];
    const sorted = sortItems(items);
    expect(sorted.map((i) => i.time)).toEqual(["08:00", "09:30", "10:00"]);
    expect(items.map((i) => i.time)).toEqual(["10:00", "08:00", "09:30"]);
  });
});

describe("schedule-model local adds storage", () => {
  it("reads empty when nothing stored", () => {
    expect(readLocalAdds("2026-11-22")).toEqual([]);
  });

  it("writes and reads a local add, deduping by id", () => {
    const add = {
      id: "a1",
      title: "Test",
      kind: "once" as const,
      project: "p",
      targetDate: "2026-11-22",
      item: { id: "a1", sessionId: "s", sessionName: "n", title: "Test", time: "09:00", kind: "once" as const, cadence: "Today only", days: [0], completed: false as const, href: "/" },
    } as ScheduleSaved;
    writeLocalAdd(add, "2026-11-22");
    expect(readLocalAdds("2026-11-22").map((a) => a.id)).toEqual(["a1"]);
    writeLocalAdd({ ...add, title: "Test2" }, "2026-11-22");
    expect(readLocalAdds("2026-11-22")).toHaveLength(1);
    expect(readLocalAdds("2026-11-22")[0].title).toBe("Test2");
  });

  it("filters invalid entries on read", () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([
      { foo: 1 },
      { id: "x", title: "ok", kind: "once", targetDate: "2026-11-22", item: mkItem("x") },
    ]));
    const result = readLocalAdds("2026-11-22");
    expect(result.map((e) => e.id)).toEqual(["x"]);
  });

  it("returns [] on corrupt JSON", () => {
    window.localStorage.setItem("schedule:local-adds", "{bad");
    expect(readLocalAdds("2026-11-22")).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify("nope"));
    expect(readLocalAdds("2026-11-22")).toEqual([]);
  });

  it("filters malformed routine entries that cannot be applied", () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([
      { id: "broken", title: "Broken", kind: "routine", targetDate: "2026-11-22" },
      { id: "valid", title: "Valid", kind: "once", targetDate: "2026-11-22", item: mkItem("valid") },
    ]));
    expect(readLocalAdds("2026-11-22").map((entry) => entry.id)).toEqual(["valid"]);
  });

  it("rejects routine entries with missing or invalid days", () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([
      {
        id: "r", title: "Broken", kind: "routine", targetDate: "2026-11-22",
        item: mkItem("r"),
        routine: { title: "Broken", time: "08:00", cadence: "Daily", href: "/" },
      },
      { id: "ok", title: "OK", kind: "once", targetDate: "2026-11-22", item: mkItem("ok") },
    ]));
    expect(readLocalAdds("2026-11-22").map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("defaults legacy entries without enabled to true", () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([
      {
        id: "legacy", title: "Legacy", kind: "routine", targetDate: "2026-11-22",
        item: { ...mkItem("legacy"), kind: "routine", days: [0] },
        routine: { id: "legacy", sessionId: "s", title: "Legacy", time: "08:00", cadence: "Daily", days: [0], href: "/" },
      },
      { id: "legacy-once", title: "Legacy once", kind: "once", targetDate: "2026-11-22", item: mkItem("legacy-once") },
    ]));
    const result = readLocalAdds("2026-11-22");
    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry.enabled).toBe(true);
      expect(entry.item.enabled).toBe(true);
      if (entry.kind === "routine") expect(entry.routine.enabled).toBe(true);
    }
  });
});

describe("schedule-model notice storage", () => {
  it("sets and takes a notice, clearing it", () => {
    setScheduleNotice("hello");
    expect(takeScheduleNotice()).toBe("hello");
    expect(takeScheduleNotice()).toBeNull();
  });

  it("returns null when no notice", () => {
    expect(takeScheduleNotice()).toBeNull();
  });
});

describe("schedule-model applyLocalAdds", () => {
  const base = emptySchedule("2026-11-22");

  it("returns schedule unchanged when no adds", () => {
    expect(applyLocalAdds(base, [])).toBe(base);
  });

  it("applies a once add for today", () => {
    const add = {
      id: "o1", title: "Once", kind: "once" as const, project: "p", targetDate: "2026-11-22",
      item: mkItem("o1", "09:00"),
    } as ScheduleSaved;
    const res = applyLocalAdds(base, [add]);
    expect(res.items.map((i) => i.id)).toEqual(["o1"]);
    expect(res.countToday).toBe(1);
  });

  it("keeps a once add targeting another date without changing today's count", () => {
    const add = {
      id: "o2", title: "Later", kind: "once" as const, project: "p", targetDate: "2026-11-23",
      item: mkItem("o2", "09:00"),
    } as ScheduleSaved;
    const res = applyLocalAdds(base, [add]);
    expect(res.items.map((item) => item.id)).toEqual(["o2"]);
    expect(res.countToday).toBe(0);
  });

  it("applies a routine add, deduping routine by id and counting when today", () => {
    const routine = { id: "r1", sessionId: "s", title: "Routine", time: "08:00", cadence: "Daily", days: [0], href: "/" };
    const add = {
      id: "r1", title: "Routine", kind: "routine" as const, project: "p",
      targetDate: "2026-11-22",
      item: { ...mkItem("r1", "08:00"), kind: "routine" as const, days: [0] },
      routine,
    } as ScheduleSaved;
    const res = applyLocalAdds(base, [add]);
    expect(res.routines.map((r) => r.id)).toEqual(["r1"]);
    expect(res.items.map((i) => i.id)).toEqual(["r1"]);
    expect(res.countToday).toBe(1);
    const res2 = applyLocalAdds(res, [add]);
    expect(res2.routines).toHaveLength(1);
    expect(res2.items).toHaveLength(1);
    expect(res2.countToday).toBe(1);
  });

  it("routine not today still registers routine but not item/count", () => {
    const routine = { id: "r2", sessionId: "s", title: "Routine2", time: "08:00", cadence: "Daily", days: [1], href: "/" };
    const add = {
      id: "r2", title: "Routine2", kind: "routine" as const, project: "p",
      targetDate: "2026-11-22",
      item: { ...mkItem("r2", "08:00"), kind: "routine" as const, days: [1] },
      routine,
    } as ScheduleSaved;
    const res = applyLocalAdds(base, [add]);
    expect(res.routines.map((r) => r.id)).toEqual(["r2"]);
    expect(res.items).toEqual([]);
    expect(res.countToday).toBe(0);
  });

  it("does not duplicate a once item when merged twice", () => {
    const add = {
      id: "dup", title: "Dedup", kind: "once" as const, project: "p", targetDate: "2026-11-22",
      item: mkItem("dup", "09:00"),
    } as ScheduleSaved;
    const first = applyLocalAdds(base, [add]);
    const second = applyLocalAdds(first, [add]);
    expect(second.items.map((i) => i.id)).toEqual(["dup"]);
    expect(second.countToday).toBe(1);
  });

  it("stops showing a routine item after its end date", () => {
    const routine = { id: "r3", sessionId: "s", title: "Ended", time: "08:00", cadence: "Daily", days: [0], href: "/", endsOn: "2026-11-21" };
    const add = {
      id: "r3", title: "Ended", kind: "routine" as const, project: "p", targetDate: "2026-11-20",
      item: { ...mkItem("r3", "08:00"), kind: "routine" as const },
      routine,
    } as ScheduleSaved;
    const res = applyLocalAdds(base, [add]);
    expect(res.routines.map((r) => r.id)).toEqual(["r3"]);
    expect(res.items).toEqual([]);
    expect(res.countToday).toBe(0);
  });

  it("keeps disabled adds visible but excludes them from today's count", () => {
    const disabledOnce = {
      id: "off-once", title: "Disabled once", kind: "once" as const, project: "p", targetDate: "2026-11-22",
      item: { ...mkItem("off-once", "09:00"), enabled: false },
      enabled: false,
    };
    const disabledRoutine = {
      id: "off-routine", title: "Disabled routine", kind: "routine" as const, project: "p",
      targetDate: "2026-11-22",
      item: { ...mkItem("off-routine", "08:00"), kind: "routine" as const, enabled: false },
      routine: { id: "off-routine", sessionId: "s", title: "Disabled routine", time: "08:00", cadence: "Daily", days: [0], href: "/", enabled: false },
      enabled: false,
    };
    const res = applyLocalAdds(base, [disabledOnce, disabledRoutine]);
    expect(res.items.map((item) => item.id)).toEqual(["off-once"]);
    expect(res.items.map((item) => item.id)).not.toContain("off-routine");
    expect(res.routines.map((routine) => routine.id)).toEqual(["off-routine"]);
    expect(res.countToday).toBe(0);
  });
});
