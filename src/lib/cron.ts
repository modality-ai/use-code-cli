const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface CronFields {
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Accept 5-field crons and 6-field crons with leading seconds. */
export function splitCron(rule: string): CronFields {
  const fields = rule.trim().split(/\s+/).filter(Boolean);
  const [minute, hour, day, month, weekday] = fields.length >= 6 ? fields.slice(-5) : fields;
  return {
    minute: minute ?? "*",
    hour: hour ?? "*",
    day: day ?? "*",
    month: month ?? "*",
    weekday: weekday ?? "*",
  };
}

export function normalizeCron(rule: string): string {
  const fields = splitCron(rule);
  return `${fields.minute} ${fields.hour} ${fields.day} ${fields.month} ${fields.weekday}`;
}

export function cronWeekdays(rule: string): number[] {
  return parseField(splitCron(rule).weekday, 0, 6, WEEKDAY_NAMES);
}

export function cronTime(rule: string): string {
  const fields = splitCron(rule);
  if (!/^\d+$/.test(fields.hour) || !/^\d+$/.test(fields.minute)) return "--:--";
  return `${pad(Number(fields.hour))}:${pad(Number(fields.minute))}`;
}

function resolveToken(token: string, names?: Record<string, number>): number | undefined {
  if (names) {
    const named = names[token.toLowerCase()];
    if (named !== undefined) return named;
  }
  const value = Number(token);
  return Number.isFinite(value) ? value : undefined;
}

function expandPart(part: string, min: number, max: number, names?: Record<string, number>): number[] {
  const [rangeToken, stepToken] = part.split("/");
  const step = stepToken === undefined ? 1 : Math.max(1, Number(stepToken) || 1);
  const [startToken, endToken] = (rangeToken ?? "").split("-");
  let start: number | undefined;
  let end: number | undefined;

  if (startToken === "*") {
    start = min;
    end = max;
  } else if (startToken) {
    start = resolveToken(startToken, names);
    end = endToken ? resolveToken(endToken, names) : start;
  }
  if (start === undefined) return [];
  if (end === undefined) end = start;

  if (names && end < start) {
    const wrapped: number[] = [];
    for (let value = start; value <= max; value += step) wrapped.push(value);
    for (let value = min; value <= end; value += step) wrapped.push(value);
    return wrapped;
  }
  if (end < start) return [];

  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function parseField(field: string, min: number, max: number, names?: Record<string, number>): number[] {
  if (!field || field === "*" || field === "?") return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const seen = new Set<number>();
  for (const part of field.split(",")) {
    if (!part) continue;
    for (const value of expandPart(part, min, max, names)) {
      const normalized = names && value === 7 && max === 6 ? 0 : value;
      if (normalized >= min && normalized <= max) seen.add(normalized);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function allFields(rule: string) {
  const fields = splitCron(rule);
  return {
    fields,
    minutes: parseField(fields.minute, 0, 59),
    hours: parseField(fields.hour, 0, 23),
    days: parseField(fields.day, 1, 31),
    months: parseField(fields.month, 1, 12, MONTH_NAMES),
    weekdays: parseField(fields.weekday, 0, 6, WEEKDAY_NAMES),
  };
}

export function isCronValid(rule: string): boolean {
  if (rule.trim().split(/\s+/).filter(Boolean).length < 5) return false;
  const parsed = allFields(rule);
  return Object.values(parsed).every((value) => !Array.isArray(value) || value.length > 0);
}

function dayMatches(date: Date, days: number[], weekdays: number[], dayField: string, weekdayField: string): boolean {
  const dayRestricted = dayField !== "*" && dayField !== "?";
  const weekdayRestricted = weekdayField !== "*" && weekdayField !== "?";
  const dayOk = days.includes(date.getDate());
  const weekdayOk = weekdays.includes(date.getDay());
  if (dayRestricted && weekdayRestricted) return dayOk || weekdayOk;
  return dayOk && weekdayOk;
}

export function cronMatchesDate(rule: string, date: Date): boolean {
  const { fields, days, months, weekdays } = allFields(rule);
  return (
    months.includes(date.getMonth() + 1) &&
    dayMatches(date, days, weekdays, fields.day, fields.weekday)
  );
}

function describeWeekday(field: string): string {
  if (field === "*" || field === "?" || !field) return "every day";
  const values = parseField(field, 0, 6, WEEKDAY_NAMES);
  if (values.length === 0) return field;
  if (values.length === 7) return "every day";
  const names = values.map((value) => WEEKDAYS[value] ?? String(value));
  if (/^\d+-\d+(?:\/\d+)?$/.test(field) || /^[a-z]+-[a-z]+$/i.test(field)) {
    const first = names[0] ?? "";
    const last = names[names.length - 1] ?? "";
    return `${first} to ${last}`;
  }
  if (names.length === 1) return names[0] ?? "";
  return names.map((name) => name.slice(0, 3)).join(", ");
}

export function cronSummary(rule: string): string {
  const { fields, minutes, hours } = allFields(rule);
  let time = "At the scheduled time";
  if (/^\d+$/.test(fields.minute) && /^\d+$/.test(fields.hour)) {
    const hour = hours[0];
    const minute = minutes[0];
    if (hour !== undefined && minute !== undefined) time = `At ${pad(hour)}:${pad(minute)}`;
  } else if (fields.minute.startsWith("*/")) {
    time = `Every ${fields.minute.slice(2)} minutes`;
  } else if (fields.hour.startsWith("*/")) {
    time = `Every ${fields.hour.slice(2)} hours`;
  }
  return `${time}, ${describeWeekday(fields.weekday)}`;
}

/** Next local-time occurrences of a cron rule. */
export function nextCronRuns(rule: string, now: Date, count = 3): Date[] {
  if (!isCronValid(rule)) return [];
  const { fields, minutes, hours, days, months, weekdays } = allFields(rule);
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const results: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const limit = new Date(start);
  limit.setFullYear(limit.getFullYear() + 2);

  for (; cursor <= limit && results.length < count; cursor.setDate(cursor.getDate() + 1)) {
    if (!months.includes(cursor.getMonth() + 1)) continue;
    if (!dayMatches(cursor, days, weekdays, fields.day, fields.weekday)) continue;

    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hour, minute, 0, 0);
        if (candidate < start) continue;
        results.push(candidate);
        if (results.length === count) return results;
      }
    }
  }
  return results;
}

/** Build a 5-field cron from a HH:MM time and optional weekday numbers (0=Sunday). */
export function timeCron(time: string, weekdays?: number[]): string {
  const [hourToken, minuteToken] = time.split(":");
  const hour = Number(hourToken);
  const minute = Number(minuteToken);
  const hourField = Number.isFinite(hour) ? String(hour) : "*";
  const minuteField = Number.isFinite(minute) ? String(minute) : "0";
  let weekdayField = "*";
  if (weekdays) {
    const days = [...new Set(weekdays)].sort((a, b) => a - b);
    if (days.length > 0 && days.length < 7) weekdayField = days.join(",");
  }
  return `${minuteField} ${hourField} * * ${weekdayField}`;
}
