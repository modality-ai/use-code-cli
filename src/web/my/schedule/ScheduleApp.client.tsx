"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { cronSummary, cronTime, cronWeekdays, isCronValid, nextCronRuns, normalizeCron, splitCron, timeCron } from "../../../lib/cron";

type ScheduleKind = "routine" | "once";
type CreateKind = "once" | "routine";

interface ScheduleItem {
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
  ends?: string;
  endsOn?: string;
  cron?: string;
}

interface ScheduleRoutine {
  id: string;
  sessionId: string;
  title: string;
  time: string;
  cadence: string;
  days: number[];
  href: string;
  ends?: string;
  endsOn?: string;
  cron?: string;
}

interface ScheduleData {
  date: string;
  countToday: number;
  items: ScheduleItem[];
  routines: ScheduleRoutine[];
}

type Tab = "all" | "once" | "routines";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "once", label: "Once" },
  { id: "routines", label: "Routines" },
];

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const eyebrow = "text-[10px] font-medium uppercase leading-[14px] tracking-[0.16em] text-text-muted";

function parseDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day, 12) : new Date();
}

function headerDate(dateKey: string): string {
  const date = parseDate(dateKey);
  return `${WEEKDAYS[date.getDay()] ?? "Today"}, ${date.getDate()} ${MONTHS[date.getMonth()] ?? ""}`.trim();
}

function longDate(dateKey: string): string {
  const date = parseDate(dateKey);
  return `${WEEKDAYS[date.getDay()] ?? "Today"}, ${date.getDate()} ${MONTHS_LONG[date.getMonth()] ?? ""}`;
}

function shortDate(dateKey: string): string {
  const date = parseDate(dateKey);
  return `${MONTHS[date.getMonth()] ?? ""} ${date.getDate()}`.trim();
}

function addDays(dateKey: string, count: number): string {
  const date = parseDate(dateKey);
  date.setDate(date.getDate() + count);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekOf(dateKey: string): Date[] {
  const date = parseDate(dateKey);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function emptySchedule(dateKey: string): ScheduleData {
  return { date: dateKey, countToday: 0, items: [], routines: [] };
}

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function sortItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => a.time.localeCompare(b.time));
}

function CheckCircle({ checked, onClick, title }: { checked: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      aria-label={`${checked ? "Mark incomplete" : "Mark complete"}: ${title}`}
      className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span
        className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors duration-150 group-active:scale-95 ${
          checked ? "border-accent-collaboration bg-accent-collaboration" : "border-border bg-transparent"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

function ScheduleCard({
  item,
  checked,
  onToggle,
}: {
  item: ScheduleItem;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const isRoutine = item.kind === "routine";
  const isLocal = item.sessionId === "local";
  const titleClass = `truncate text-[15px] font-semibold leading-5 ${checked ? "line-through decoration-border" : ""}`;
  const title = isLocal ? (
    <span className={titleClass}>{item.title}</span>
  ) : (
    <a href={item.href} className={`${titleClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}>
      {item.title}
    </a>
  );
  const detail = item.cadence;

  return (
    <article className={`schedule-card ${checked ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <time className="font-code text-xs font-medium tabular-nums text-text-muted">{item.time}</time>
            {title}
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs font-medium leading-4">
            <span className={`h-1.5 w-1.5 rounded-full ${isRoutine ? "bg-accent-collaboration" : "bg-orange"}`} aria-hidden="true" />
            <span className={isRoutine ? "text-accent-collaboration" : "text-orange"}>
              {isRoutine ? "Routine" : "Once"}
            </span>
            <span className="text-text-muted">• {detail}</span>
          </p>
        </div>
        <CheckCircle checked={checked} onClick={() => onToggle(item.id)} title={item.title} />
      </div>
    </article>
  );
}

function SkeletonCards() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="schedule-card">
          <div className="flex items-center gap-3">
            <div className="schedule-skeleton h-3 w-10 rounded-sm" />
            <div className="schedule-skeleton h-4 w-40 rounded-sm" />
            <div className="schedule-skeleton ml-auto h-[22px] w-[22px] rounded-full" />
          </div>
          <div className="schedule-skeleton mt-3 h-3 w-28 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

function DayPill({ label, active, today }: { label: string; active: boolean; today: boolean }) {
  return (
    <span
      aria-label={`${label}${active ? ", active routine day" : ""}${today ? ", today" : ""}`}
      className={`relative flex h-11 w-11 flex-col items-center justify-center rounded-[14px] text-center ${
        active ? "border border-teal-line bg-teal-soft text-accent-collaboration" : "text-text-muted"
      }`}
    >
      <span className="text-[10px] font-medium uppercase leading-[14px] tracking-[0.12em]">{label}</span>
      {today && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-orange" aria-hidden="true" />}
    </span>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: React.ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="mt-5">
      <legend className={eyebrow}>{legend}</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`h-11 rounded-[14px] border text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              value === option.value
                ? "border-teal-line bg-teal-soft text-accent-collaboration"
                : "border-border bg-surface text-text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FieldRow({
  label,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4">
      <label htmlFor={htmlFor} className="text-sm font-medium text-text-primary">{label}</label>
      {children}
    </div>
  );
}

function FieldCard({ label, htmlFor, children, testId }: { label: string; htmlFor: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-[16px] bg-shell p-1.5 ring-1 ring-black/5">
      <div className="rounded-[12px] bg-surface px-3 py-2">
        <label htmlFor={htmlFor} className={eyebrow}>{label}</label>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

function EndsControl({
  ends,
  endDate,
  onEndsChange,
  onEndDateChange,
  minDate,
}: {
  ends: string;
  endDate: string;
  onEndsChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  minDate: string;
}) {
  const invalidDate = !endDate || endDate < minDate;
  return (
    <FieldCard label="Ends" htmlFor="schedule-ends" testId="ends-control">
      <select
        id="schedule-ends"
        value={ends}
        onChange={(event) => onEndsChange(event.target.value)}
        className="w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <option value="Never">Never</option>
        <option value="On a date">On a date</option>
      </select>
      {ends === "On a date" && (
        <div className="mt-2 border-t border-border/70 pt-2">
          <label htmlFor="schedule-end-date" className="text-[10px] font-medium uppercase leading-[14px] tracking-[0.12em] text-text-muted">Ends on date</label>
          <input
            id="schedule-end-date"
            type="date"
            value={endDate}
            min={minDate}
            aria-invalid={invalidDate}
            aria-describedby={invalidDate ? "schedule-end-date-error" : undefined}
            onInput={(event) => onEndDateChange(event.currentTarget.value)}
            onChange={(event) => onEndDateChange(event.target.value)}
            className="mt-1 h-9 w-full cursor-pointer rounded-[10px] border border-border bg-surface px-2 text-xs tabular-nums text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          {invalidDate && (
            <p id="schedule-end-date-error" className="mt-1 text-[11px] text-orange" role="alert">Choose today or a later date.</p>
          )}
        </div>
      )}
    </FieldCard>
  );
}

function formatRun(date: Date): string {
  const weekday = WEEKDAYS[date.getDay()]?.slice(0, 3) ?? "";
  const month = MONTHS[date.getMonth()] ?? "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${weekday} ${date.getDate()} ${month} • ${hours}:${minutes}`;
}

function SchedulePreview({
  summary,
  runs,
  expression,
  showExpression = true,
  emptyLabel,
}: {
  summary: string;
  runs: Date[];
  expression: string;
  showExpression?: boolean;
  emptyLabel?: string;
}) {
  return (
    <section className="mt-5 rounded-[16px] bg-shell p-1.5 ring-1 ring-black/5" aria-label="Schedule preview">
      <div className="rounded-[12px] bg-surface p-4">
        <p className="flex items-start gap-2 text-sm font-medium text-text-primary">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-accent-collaboration" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span aria-live="polite">{summary}</span>
        </p>
        <h3 className={`${eyebrow} mt-4`}>Next runs</h3>
        <ul className="mt-2 space-y-1 text-xs tabular-nums text-text-muted">
          {runs.length === 0 ? (
            <li>{emptyLabel ?? "No upcoming runs in the next 2 years"}</li>
          ) : runs.map((run) => (
            <li key={run.toISOString()}>{formatRun(run)}</li>
          ))}
        </ul>
        {showExpression && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
            <span className="text-text-muted">Cron equivalent</span>
            <code className="font-code tabular-nums text-text-primary">{expression}</code>
          </div>
        )}
      </div>
    </section>
  );
}

const inputClass =
  "h-11 rounded-[12px] border border-border bg-surface px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export default function ScheduleApp({ initial }: { initial?: ScheduleData }) {
  const [schedule, setSchedule] = useState<ScheduleData>(() => {
    const dehydrated = typeof window !== "undefined" ? (window as any).__REACT_DATA__?.schedule : undefined;
    if (dehydrated && typeof dehydrated === "object") return dehydrated as ScheduleData;
    return initial ?? emptySchedule(todayKey());
  });
  const [tab, setTab] = useState<Tab>("all");
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [createKind, setCreateKind] = useState<CreateKind>("once");
  const [what, setWhat] = useState("");
  const [when, setWhen] = useState<"today" | "tomorrow" | "pick">("today");
  const [pickDate, setPickDate] = useState(schedule.date);
  const [time, setTime] = useState("09:00");
  const [repeats, setRepeats] = useState<"daily" | "weekly" | "cron">("daily");
  const [weekDays, setWeekDays] = useState<number[]>([1, 3, 5]);
  const [cronRule, setCronRule] = useState("30 7 * * 1-5");
  const [ends, setEnds] = useState("Never");
  const [endDate, setEndDate] = useState(schedule.date);

  const dialogRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const whatRef = useRef<HTMLInputElement>(null);
  const localSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/my/api/schedule");
        const payload = await response.json();
        if (!response.ok || !payload?.success || !payload?.data) {
          throw new Error(payload?.error || `Request failed with ${response.status}`);
        }
        if (!cancelled) {
          setSchedule(payload.data as ScheduleData);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(`schedule:completed:${schedule.date}`) : null;
      const ids = raw ? JSON.parse(raw) : [];
      setCompleted(new Set(Array.isArray(ids) ? ids.map(String) : []));
    } catch {
      setCompleted(new Set());
    }
  }, [schedule.date]);

  useEffect(() => {
    if (!createOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => whatRef.current?.focus(), 0);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCreate();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [createOpen]);

  const toggleComplete = (id: string) => {
    const next = new Set(completed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCompleted(next);
    try {
      localStorage.setItem(`schedule:completed:${schedule.date}`, JSON.stringify([...next]));
    } catch {
      // completion stays local to this view when storage is unavailable
    }
  };

  const openCreate = () => {
    setCreateKind("once");
    setWhat("");
    setWhen("today");
    setPickDate(schedule.date);
    setTime("09:00");
    setRepeats("daily");
    setWeekDays([1, 3, 5]);
    setCronRule("30 7 * * 1-5");
    setEnds("Never");
    setEndDate(schedule.date);
    setNotice(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setTimeout(() => addButtonRef.current?.focus(), 0);
  };

  const selectCreateKind = (kind: CreateKind) => {
    setCreateKind(kind);
  };

  const endInvalid = createKind === "routine" && ends === "On a date" && (!endDate || endDate < schedule.date);

  const canSave = what.trim().length > 0 && !(
    createKind === "routine" && (
      (repeats === "weekly" && weekDays.length === 0) ||
      (repeats === "cron" && !isCronValid(cronRule)) ||
      endInvalid
    )
  );

  const routineExpression = useMemo(() => {
    if (repeats === "cron") return normalizeCron(cronRule);
    return timeCron(time, repeats === "weekly" ? weekDays : undefined);
  }, [repeats, cronRule, time, weekDays]);

  const routineRuns = useMemo(() => {
    if (!isCronValid(routineExpression)) return [];
    let until: Date | undefined;
    if (ends === "On a date" && endDate) {
      const parsed = parseDate(endDate);
      if (!Number.isNaN(parsed.getTime())) {
        parsed.setHours(23, 59, 59, 999);
        until = parsed;
      }
    }
    return nextCronRuns(routineExpression, new Date(), 3, until);
  }, [routineExpression, ends, endDate]);

  const routineSummary = repeats === "daily"
    ? `Every day at ${time}`
    : repeats === "weekly"
      ? `Every ${[...weekDays].sort((a, b) => a - b).map((day) => WEEKDAYS[day]?.slice(0, 3)).join(", ") || "selected days"} at ${time}`
      : cronSummary(routineExpression);

  const cronChips = splitCron(cronRule);

  const saveCreate = () => {
    const title = what.trim();
    if (!title || !canSave) return;
    localSeq.current += 1;
    const id = `local-${Date.now()}-${localSeq.current}`;

    if (createKind === "once") {
      const targetDate = when === "today" ? schedule.date : when === "tomorrow" ? addDays(schedule.date, 1) : pickDate || schedule.date;
      const cadence = when === "today" ? "Today only" : when === "tomorrow" ? "Tomorrow" : shortDate(targetDate);
      const item: ScheduleItem = {
        id,
        sessionId: "local",
        sessionName: "You",
        title,
        time,
        kind: "once",
        cadence,
        days: [parseDate(targetDate).getDay()],
        completed: false,
        href: "/my/sessions",
      };
      setSchedule((previous) => ({
        ...previous,
        countToday: previous.countToday + (targetDate === previous.date ? 1 : 0),
        items: sortItems([...previous.items, item]),
      }));
      setNotice(`Added "${title}" locally.`);
    } else {
      const allDays = [0, 1, 2, 3, 4, 5, 6];
      const days = repeats === "daily"
        ? allDays
        : repeats === "weekly"
          ? [...weekDays].sort((a, b) => a - b)
          : cronWeekdays(cronRule);
      const expression = repeats === "cron" ? normalizeCron(cronRule) : timeCron(time, repeats === "weekly" ? days : undefined);
      const cadence = repeats === "daily"
        ? "Daily"
        : repeats === "weekly"
          ? days.map((day) => WEEKDAYS[day]?.slice(0, 3)).join(", ")
          : cronSummary(expression);
      const effectiveTime = repeats === "cron" ? cronTime(expression) : time;
      const endsOn = ends === "On a date" ? endDate : undefined;
      const routine: ScheduleRoutine = {
        id,
        sessionId: "local",
        title,
        time: effectiveTime,
        cadence,
        days,
        href: "/my/sessions",
        ends,
        endsOn,
        cron: expression,
      };
      const routineItem: ScheduleItem = {
        id,
        sessionId: "local",
        sessionName: "You",
        title,
        time: effectiveTime,
        kind: "routine",
        cadence,
        days,
        completed: false,
        href: "/my/sessions",
        ends,
        endsOn,
        cron: expression,
      };
      const isToday = days.includes(parseDate(schedule.date).getDay());
      setSchedule((previous) => ({
        ...previous,
        countToday: previous.countToday + (isToday ? 1 : 0),
        items: isToday ? sortItems([...previous.items, routineItem]) : previous.items,
        routines: [...previous.routines, routine],
      }));
      setNotice(`Added "${title}" locally.`);
    }
    closeCreate();
  };

  const visibleItems = useMemo(() => {
    if (tab === "all") return schedule.items;
    return schedule.items.filter((item) => item.kind === tab);
  }, [schedule.items, tab]);

  const days = useMemo(() => weekOf(schedule.date), [schedule.date]);
  const todayIndex = parseDate(schedule.date).getDay();

  const handleTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const current = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(current + offset + TABS.length) % TABS.length];
    if (next) setTab(next.id);
  };

  return (
    <>
      <main className="schedule-page mx-auto w-full max-w-[440px] px-5 pb-28 pt-5 md:max-w-[880px] md:pb-8 xl:max-w-[1120px]">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={eyebrow}>{headerDate(schedule.date)}</p>
            <div className="mt-1 flex items-baseline gap-3">
              <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.02em] font-display text-balance">Schedule</h1>
              <span className="text-xs font-medium tabular-nums text-text-muted" aria-live="polite">
                {schedule.countToday} today
              </span>
            </div>
          </div>
          <button
            ref={addButtonRef}
            type="button"
            onClick={openCreate}
            aria-haspopup="dialog"
            aria-controls="schedule-create"
            className="schedule-add fixed bottom-[calc(20px+env(safe-area-inset-bottom))] right-[calc(20px+env(safe-area-inset-right))] z-20 flex h-14 w-14 items-center justify-center rounded-[20px] bg-accent-collaboration text-white shadow-[0_12px_28px_-10px_rgba(11,101,96,.45)] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:static md:ml-auto md:translate-y-0"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Add schedule item</span>
          </button>
        </header>

        {notice && (
          <p className="mt-4 rounded-[12px] border border-teal-line bg-teal-soft p-3 text-sm text-accent-collaboration" role="status">
            {notice}
          </p>
        )}

        <div
          role="tablist"
          aria-label="Schedule filters"
          onKeyDown={handleTabKey}
          className="relative mt-5 grid h-11 grid-cols-3 rounded-[14px] bg-shell p-1"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-[10px] bg-surface shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none"
            style={{ transform: `translateX(${TABS.findIndex((entry) => entry.id === tab) * 100}%)` }}
          />
          {TABS.map((entry) => (
            <button
              key={entry.id}
              id={`schedule-tab-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              aria-controls="schedule-panel"
              onClick={() => setTab(entry.id)}
              className={`relative z-10 cursor-pointer appearance-none rounded-[10px] border-0 bg-transparent text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                tab === entry.id ? "text-text-primary" : "text-text-muted"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mt-6 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden md:block" aria-label="Routine week">
            <div className="rounded-[20px] bg-shell p-1.5 ring-1 ring-black/5">
              <div className="rounded-2xl bg-surface p-4">
                <h2 className={eyebrow}>This week</h2>
                <div className="mt-3 space-y-1">
                  {days.map((day) => {
                    const index = day.getDay();
                    const active = schedule.routines.some((routine) => routine.days.includes(index));
                    return (
                      <div
                        key={day.toISOString()}
                        className={`flex items-center justify-between rounded-[10px] px-2 py-1.5 text-xs ${index === todayIndex ? "bg-teal-soft text-accent-collaboration" : "text-text-muted"}`}
                      >
                        <span className="font-medium">{WEEKDAYS[index]}</span>
                        <span className="tabular-nums">{day.getDate()}</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent-collaboration" : "bg-border"}`} aria-hidden="true" />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <section role="tabpanel" id="schedule-panel" aria-labelledby={`schedule-tab-${tab}`}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className={eyebrow}>Today</h2>
                <span className="text-xs tabular-nums text-text-muted">{visibleItems.length} shown</span>
              </div>

              {error && (
                <div className="rounded-[16px] border border-border bg-surface p-4 text-sm text-text-primary" role="alert">
                  <p>Could not load the schedule: {error}</p>
                  <button
                    type="button"
                    onClick={() => { setLoading(true); setReload((value) => value + 1); }}
                    className="mt-2 rounded-sm border border-border px-2 py-0.5 text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Retry
                  </button>
                </div>
              )}

              {!error && loading && <SkeletonCards />}

              {!error && !loading && visibleItems.length === 0 && (
                <div className="rounded-[16px] border border-border bg-surface p-4 text-sm text-text-muted">
                  Nothing scheduled for {longDate(schedule.date)}.
                </div>
              )}

              {!error && visibleItems.length > 0 && (
                <div className="space-y-3">
                  {visibleItems.map((item, index) => (
                    <div key={item.id} className="schedule-reveal" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
                      <ScheduleCard item={item} checked={completed.has(item.id)} onToggle={toggleComplete} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-7" aria-labelledby="schedule-routines-heading">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="schedule-routines-heading" className={eyebrow}>Your routines</h2>
                <a href="/my/sessions" className="text-xs font-medium text-accent-collaboration hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  Manage
                </a>
              </div>

              {schedule.routines.length === 0 ? (
                <p className="text-sm text-text-muted">No recurring jobs yet.</p>
              ) : (
                <div className="space-y-3">
                  {schedule.routines.map((routine) => {
                    const isLocal = routine.sessionId === "local";
                    const titleClass = "text-[15px] font-semibold leading-5";
                    const detail = routine.endsOn ? `${routine.cadence} · Ends ${shortDate(routine.endsOn)}` : routine.cadence;
                    return (
                      <article key={routine.id} className="schedule-card">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            {isLocal ? (
                              <span className={titleClass}>{routine.title}</span>
                            ) : (
                              <a href={routine.href} className={`${titleClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}>
                                {routine.title}
                              </a>
                            )}
                            <p className="mt-2 text-xs leading-4 text-text-muted">
                              <span className="font-code tabular-nums">{routine.time}</span> • {detail}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5" aria-label={`Runs on ${routine.days.map((day) => WEEKDAYS[day]).join(", ")}`}>
                            {DAY_LETTERS.map((letter, index) => (
                              <DayPill key={`${routine.id}-${index}`} label={letter ?? ""} active={routine.days.includes(index)} today={index === todayIndex} />
                            ))}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {createOpen && (
        <div
          id="schedule-create"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-create-title"
          data-testid="schedule-create"
          className="fixed inset-0 z-40 overflow-y-auto bg-paper"
        >
          <form
            onSubmit={(event) => { event.preventDefault(); saveCreate(); }}
            className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5"
          >
            <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <button
                type="button"
                onClick={closeCreate}
                className="justify-self-start rounded-sm text-sm text-text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                Cancel
              </button>
              <h2 id="schedule-create-title" className="text-[15px] font-semibold leading-5 text-text-primary">New item</h2>
              <span aria-hidden="true" />
            </header>

            <div className="relative mt-5 grid h-11 grid-cols-2 rounded-[14px] bg-shell p-1" role="tablist" aria-label="Item type">
              <span
                aria-hidden="true"
                className={`absolute inset-y-1 left-1 w-[calc((100%-8px)/2)] rounded-[10px] bg-surface ring-1 ring-black/5 shadow-[0_6px_14px_-8px_rgba(29,29,27,.3)] transition-transform duration-[220ms] ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none`}
                style={{ transform: `translateX(${createKind === "once" ? 0 : 100}%)` }}
              />
              {(["once", "routine"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={createKind === kind}
                  aria-pressed={createKind === kind}
                  onClick={() => selectCreateKind(kind)}
                  className={`relative z-10 cursor-pointer appearance-none rounded-[10px] border-0 bg-transparent text-sm transition-[color,background-color,transform,box-shadow] duration-[220ms] ease-[cubic-bezier(.16,1,.3,1)] hover:text-text-primary active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none motion-reduce:transform-none ${
                    createKind === kind ? "font-semibold text-text-primary" : "font-medium text-text-muted hover:bg-surface/60"
                  }`}
                >
                  {kind === "once" ? "Once" : "Routine"}
                </button>
              ))}
            </div>

            <fieldset className="mt-6">
              <legend className={eyebrow}>What</legend>
              <input
                ref={whatRef}
                id="schedule-what"
                type="text"
                value={what}
                onInput={(event) => setWhat(event.currentTarget.value)}
                placeholder="What needs doing?"
                className={`${inputClass} mt-2 w-full`}
              />
            </fieldset>

            {createKind === "once" ? (
              <>
                <ChoiceGroup
                  legend="When"
                  value={when}
                  options={[
                    { value: "today", label: "Today" },
                    { value: "tomorrow", label: "Tomorrow" },
                    { value: "pick", label: <><span className="cursor-pointer" aria-hidden="true">📅</span> Pick date</> },
                  ]}
                  onChange={setWhen}
                />
                {when === "pick" && (
                  <FieldRow label="Date" htmlFor="schedule-pick-date">
                    <input
                      id="schedule-pick-date"
                      type="date"
                      value={pickDate}
                      onChange={(event) => setPickDate(event.target.value)}
                      className={inputClass}
                    />
                  </FieldRow>
                )}
                <FieldRow label={<><span className="cursor-pointer" aria-hidden="true">⏱️</span> Time</>} htmlFor="schedule-time">
                  <input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
                </FieldRow>
              </>
            ) : (
              <>
                <ChoiceGroup
                  legend="Repeats"
                  value={repeats}
                  options={[
                    { value: "daily", label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                    { value: "cron", label: "Cron" },
                  ]}
                  onChange={setRepeats}
                />

                {repeats === "weekly" && (
                  <fieldset className="mt-5">
                    <legend className={eyebrow}>On</legend>
                    <div className="mt-2 grid grid-cols-7 gap-1.5">
                      {DAY_LETTERS.map((letter, index) => {
                        const active = weekDays.includes(index);
                        return (
                          <button
                            key={index}
                            type="button"
                            aria-pressed={active}
                            aria-label={WEEKDAYS[index]}
                            onClick={() => setWeekDays((current) => active ? current.filter((value) => value !== index) : [...current, index])}
                            className={`flex h-11 items-center justify-center rounded-[14px] border text-xs font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                              active ? "border-teal-line bg-teal-soft text-accent-collaboration" : "border-border bg-surface text-text-muted"
                            }`}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {repeats === "cron" && (
                  <fieldset className="mt-5">
                    <legend className={eyebrow}>Cron rule</legend>
                    <p id="schedule-cron-hint" className="mt-1 text-xs text-text-muted">* any • */5 step • 1-5 range • 1,3 list</p>
                    <input
                      id="schedule-cron"
                      type="text"
                      value={cronRule}
                      onInput={(event) => setCronRule(event.currentTarget.value)}
                      aria-describedby="schedule-cron-hint"
                      aria-invalid={!isCronValid(cronRule)}
                      className={`${inputClass} mt-2 w-full font-code tabular-nums`}
                    />
                    {!isCronValid(cronRule) && (
                      <p className="mt-1 text-xs text-orange" role="alert">Enter a valid 5-field cron rule</p>
                    )}
                    <div className="mt-3 grid grid-cols-5 gap-2">
                      {([
                        ["min", cronChips.minute],
                        ["hour", cronChips.hour],
                        ["day", cronChips.day],
                        ["month", cronChips.month],
                        ["weekday", cronChips.weekday],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="rounded-[12px] bg-shell p-1 ring-1 ring-black/5">
                          <div className="rounded-[8px] bg-surface px-1 py-2 text-center">
                            <span className="block truncate font-code text-xs tabular-nums text-text-primary">{value}</span>
                            <span className={`${eyebrow} mt-1 block`}>{label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                )}

                {repeats !== "cron" && (
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <FieldCard label="Time" htmlFor="schedule-time">
                      <input
                        id="schedule-time"
                        type="time"
                        value={time}
                        onChange={(event) => setTime(event.target.value)}
                        className="w-full cursor-pointer border-0 bg-transparent p-0 font-code text-base tabular-nums text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </FieldCard>
                    <EndsControl
                      ends={ends}
                      endDate={endDate}
                      onEndsChange={setEnds}
                      onEndDateChange={setEndDate}
                      minDate={schedule.date}
                    />
                  </div>
                )}

                <SchedulePreview
                  summary={routineSummary}
                  runs={routineRuns}
                  expression={routineExpression}
                  showExpression={repeats !== "cron"}
                  emptyLabel={ends === "On a date" ? "No upcoming runs before this end date" : "No upcoming runs in the next 2 years"}
                />

                {repeats === "cron" && (
                  <div className="mt-4">
                    <EndsControl
                      ends={ends}
                      endDate={endDate}
                      onEndsChange={setEnds}
                      onEndDateChange={setEndDate}
                      minDate={schedule.date}
                    />
                  </div>
                )}

              </>
            )}

            <div className="mt-auto pt-8">
              <button
                type="submit"
                disabled={!canSave}
                className={`h-12 w-full rounded-[16px] text-sm font-semibold text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  createKind === "once"
                    ? "bg-orange shadow-[0_12px_28px_-10px_rgba(168,65,12,.45)]"
                    : "bg-accent-collaboration shadow-[0_12px_28px_-10px_rgba(11,101,96,.45)]"
                }`}
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
