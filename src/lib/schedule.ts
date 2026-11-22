import { aiTool } from "../scripts/index";
import { cronMatchesDate, cronTime, cronWeekdays as cronDays } from "./cron";

export type ScheduleKind = "routine" | "once";

export interface ScheduleItem {
  id: string;
  sessionId: string;
  sessionName: string;
  title: string;
  time: string;
  kind: ScheduleKind;
  cadence: string;
  days: number[];
  completed: false;
  href: string;
}

export interface ScheduleRoutine {
  id: string;
  sessionId: string;
  title: string;
  time: string;
  cadence: string;
  days: number[];
  href: string;
}

export interface ScheduleData {
  date: string;
  countToday: number;
  items: ScheduleItem[];
  routines: ScheduleRoutine[];
}

type Execute = (props: Record<string, unknown>) => unknown | Promise<unknown>;

interface SessionRef {
  sessionId: string;
  sessionName: string;
  href: string;
}

interface SessionSchedule {
  ref: SessionRef;
  crons: unknown[];
  monitors: unknown[];
}

const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12);
}

export function weekdayLong(index: number): string {
  return DAY_LONG[index] ?? "Today";
}

export function weekdayShort(index: number): string {
  return DAY_SHORT[index] ?? "";
}

function cadenceFor(days: number[], recurring: boolean): string {
  if (!recurring) return "Today only";
  if (days.length === 7) return "Daily";
  if (days.length === 1) {
    const name = weekdayLong(days[0] ?? 0);
    return name === "Wednesday" ? "Wednesdays" : name === "Saturday" ? "Saturdays" : `${name}s`;
  }
  if (days.length === 0) return "Daily";
  return days.map((day) => weekdayLong(day).slice(0, 3)).join(", ");
}

function titleFromPrompt(prompt: unknown): string {
  const firstLine = str(prompt).split("\n")[0] ?? "";
  const title = firstLine
    .replace(/^\s*(?:[-*#>]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || "Scheduled task";
}

function sessionRef(value: unknown): SessionRef {
  const record = asRecord(value) ?? {};
  const sessionId = str(record.sessionId) || str(record.name) || str(record.pid);
  const sessionName = str(record.name) || sessionId || "Session";
  return {
    sessionId,
    sessionName,
    href: `/my/session/${encodeURIComponent(sessionId || sessionName)}`,
  };
}

function parseCreatedAt(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = str(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Build the schedule shape from command results. Exported for focused unit tests. */
export function buildSchedule(sessions: SessionSchedule[], now: Date): ScheduleData {
  const date = dateKey(now);
  const today = now.getDay();
  const items: ScheduleItem[] = [];
  const routines: ScheduleRoutine[] = [];

  for (const session of sessions) {
    const { ref } = session;

    session.crons.forEach((raw, index) => {
      const cron = asRecord(raw) ?? {};
      const expression = str(cron.cron);
      const id = str(cron.id) || `${ref.sessionId}-cron-${index}`;
      const recurring = cron.recurring !== false;
      const days = cronDays(expression);
      const time = cronTime(expression);
      const humanSchedule = str(cron.schedule);
      const cadence = humanSchedule || cadenceFor(days, recurring);
      const title = titleFromPrompt(cron.prompt);

      if (recurring) {
        routines.push({ id, sessionId: ref.sessionId, title, time, cadence, days, href: ref.href });
      }
      if (!cronMatchesDate(expression, now)) return;
      if (recurring && !days.includes(today)) return;

      items.push({
        id,
        sessionId: ref.sessionId,
        sessionName: ref.sessionName,
        title,
        time,
        kind: recurring ? "routine" : "once",
        cadence,
        days,
        completed: false,
        href: ref.href,
      });
    });

    session.monitors.forEach((raw, index) => {
      const monitor = asRecord(raw) ?? {};
      const id = str(monitor.id) || `${ref.sessionId}-monitor-${index}`;
      const createdAt = parseCreatedAt(monitor.createdAt) ?? now;
      items.push({
        id: `monitor:${id}`,
        sessionId: ref.sessionId,
        sessionName: ref.sessionName,
        title: str(monitor.description) || "Background monitor",
        time: formatTime(createdAt),
        kind: "once",
        cadence: "Today only",
        days: [today],
        completed: false,
        href: ref.href,
      });
    });
  }

  items.sort((a, b) => a.time.localeCompare(b.time));
  return { date, countToday: items.length, items, routines };
}

export interface FetchScheduleOptions {
  execute?: Execute;
  now?: Date;
}

/** Aggregate crons and monitors from every session via the in-process aiTool commands. */
export async function fetchSchedule(options: FetchScheduleOptions = {}): Promise<ScheduleData> {
  const execute = options.execute ?? ((props: Record<string, unknown>) => aiTool.execute(props as never));
  const now = options.now ?? new Date();

  const sessionsResult = await execute({ command: "sessions" });
  const sessionRecords = asArray(asRecord(sessionsResult)?.data);
  const details = await Promise.all(
    sessionRecords.map(async (raw): Promise<SessionSchedule | undefined> => {
      const ref = sessionRef(raw);
      if (!ref.sessionId) return undefined;
      try {
        const result = await execute({ command: "session", target: ref.sessionId });
        const data = asRecord(result)?.data;
        const record = asRecord(data);
        return {
          ref,
          crons: asArray(record?.crons),
          monitors: asArray(record?.monitors),
        };
      } catch {
        return { ref, crons: [], monitors: [] };
      }
    }),
  );

  return buildSchedule(details.filter((entry): entry is SessionSchedule => Boolean(entry)), now);
}
