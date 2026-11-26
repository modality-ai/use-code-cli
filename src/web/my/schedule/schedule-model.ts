import type {
  ScheduleData as BaseScheduleData,
  ScheduleItem as BaseScheduleItem,
  ScheduleRoutine as BaseScheduleRoutine,
} from "../../../lib/schedule";
import { parseDate, todayKey } from "../../../lib/schedule-date";

export type CreateKind = "once" | "routine";

export interface ScheduleItem extends BaseScheduleItem {
  ends?: string;
  endsOn?: string;
  cron?: string;
  project?: string;
  enabled?: boolean;
}

export interface ScheduleRoutine extends BaseScheduleRoutine {
  ends?: string;
  endsOn?: string;
  cron?: string;
  project?: string;
  enabled?: boolean;
}

export interface ScheduleData extends BaseScheduleData {
  items: ScheduleItem[];
  routines: ScheduleRoutine[];
}

export type ScheduleSaved =
  | {
      id: string;
      title: string;
      kind: "once";
      project: string;
      item: ScheduleItem;
      targetDate: string;
      enabled?: boolean;
    }
  | {
      id: string;
      title: string;
      kind: "routine";
      project: string;
      item: ScheduleItem;
      routine: ScheduleRoutine;
      targetDate: string;
      enabled?: boolean;
    };

export const eyebrow = "text-[10px] font-medium uppercase leading-[14px] tracking-[0.16em] text-text-muted";

export function emptySchedule(dateKey: string): ScheduleData {
  return { date: dateKey, countToday: 0, items: [], routines: [] };
}

export function sortItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => a.time.localeCompare(b.time));
}

const LOCAL_ADDS_KEY = "schedule:local-adds";
const NOTICE_KEY = "schedule:notice";

function isWeekdayList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function normalizeEnabled(entry: ScheduleSaved): ScheduleSaved {
  const enabled = entry.enabled !== false;
  const item = { ...entry.item, enabled };
  if (entry.kind === "routine") {
    return { ...entry, enabled, item, routine: { ...entry.routine, enabled } };
  }
  return { ...entry, enabled, item };
}

function isEntryEnabled(entry: ScheduleSaved): boolean {
  return entry.enabled !== false && entry.item.enabled !== false &&
    (entry.kind !== "routine" || entry.routine.enabled !== false);
}

export function readLocalAdds(dateKey: string = todayKey()): ScheduleSaved[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_ADDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ScheduleSaved => {
      if (!entry || typeof entry !== "object") return false;
      const saved = entry as Record<string, unknown>;
      const item = saved.item as Record<string, unknown> | undefined;
      if (typeof saved.id !== "string" || typeof saved.title !== "string") return false;
      if (saved.kind !== "once" && saved.kind !== "routine") return false;
      if (typeof saved.targetDate !== "string" || saved.targetDate < dateKey) return false;
      if (!item || typeof item.time !== "string" || !isWeekdayList(item.days)) return false;
      if (typeof item.id !== "string" || typeof item.title !== "string") return false;
      if (typeof item.kind !== "string" || typeof item.cadence !== "string") return false;
      if (saved.kind !== "routine") return true;
      const routine = saved.routine as Record<string, unknown> | undefined;
      const valid = Boolean(
        routine && typeof routine === "object" && !Array.isArray(routine) &&
        typeof routine.title === "string" && typeof routine.time === "string" &&
        typeof routine.cadence === "string" && typeof routine.href === "string" &&
        isWeekdayList(routine.days),
      );
      return valid && !(typeof routine?.endsOn === "string" && routine.endsOn < dateKey);
    }).map(normalizeEnabled);
  } catch {
    return [];
  }
}

export function writeLocalAdd(add: ScheduleSaved, dateKey: string = todayKey()): boolean {
  if (typeof window === "undefined" || add.targetDate < dateKey) return false;
  try {
    const next = [...readLocalAdds(dateKey).filter((entry) => entry.id !== add.id), add];
    window.localStorage.setItem(LOCAL_ADDS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function setScheduleNotice(message: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NOTICE_KEY, message);
  } catch {
    // Ignore private-mode / quota failures.
  }
}

export function takeScheduleNotice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const message = window.sessionStorage.getItem(NOTICE_KEY);
    if (message) window.sessionStorage.removeItem(NOTICE_KEY);
    return message;
  } catch {
    return null;
  }
}

export function applyLocalAdds(schedule: ScheduleData, adds: ScheduleSaved[]): ScheduleData {
  if (adds.length === 0) return schedule;
  const itemIds = new Set(schedule.items.map((item) => item.id));
  const routineIds = new Set(schedule.routines.map((routine) => routine.id));
  let items = [...schedule.items];
  let routines = [...schedule.routines];
  const todayWeekday = parseDate(schedule.date).getDay();
  let addedToday = false;

  for (const add of adds) {
    if (add.kind === "routine") {
      if (!routineIds.has(add.id)) {
        routineIds.add(add.id);
        routines = [...routines, add.routine];
      }
      if (itemIds.has(add.id)) continue;
      const activeDay = add.item.days.includes(todayWeekday);
      const started = add.targetDate <= schedule.date;
      const notEnded = !add.routine.endsOn || schedule.date <= add.routine.endsOn;
      if (!isEntryEnabled(add) || !activeDay || !started || !notEnded) continue;
      addedToday = true;
    } else {
      if (itemIds.has(add.id)) continue;
      if (isEntryEnabled(add) && add.targetDate === schedule.date) addedToday = true;
    }
    itemIds.add(add.id);
    items = sortItems([...items, add.item]);
  }

  return {
    ...schedule,
    countToday: addedToday ? items.length : schedule.countToday,
    items,
    routines,
  };
}
