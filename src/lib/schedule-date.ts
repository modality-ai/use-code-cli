export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
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
  return WEEKDAYS[index] ?? "Today";
}

export function weekdayShort(index: number): string {
  return DAY_LETTERS[index] ?? "";
}

export function monthAbbrev(month: number): string {
  return MONTHS[month] ?? "";
}

export function parseDate(value: string): Date {
  return parseDateKey(value);
}

export function headerDate(value: string): string {
  return `${weekdayLong(parseDate(value).getDay())}, ${parseDate(value).getDate()} ${monthAbbrev(parseDate(value).getMonth())}`.trim();
}

export function longDate(value: string): string {
  const date = parseDate(value);
  return `${weekdayLong(date.getDay())}, ${date.getDate()} ${MONTHS_LONG[date.getMonth()] ?? ""}`;
}

export function shortDate(value: string): string {
  const date = parseDate(value);
  return `${monthAbbrev(date.getMonth())} ${date.getDate()}`.trim();
}

export function addDays(value: string, count: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + count);
  return dateKey(date);
}

export function weekOf(value: string): Date[] {
  const date = parseDate(value);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function todayKey(): string {
  return dateKey(new Date());
}
