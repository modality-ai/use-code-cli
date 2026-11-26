"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  DAY_LETTERS,
  headerDate,
  longDate,
  parseDate,
  shortDate,
  todayKey,
  weekOf,
  WEEKDAYS,
} from "../../../lib/schedule-date";
import {
  applyLocalAdds,
  eyebrow,
  emptySchedule,
  readLocalAdds,
  takeScheduleNotice,
  type ScheduleData,
  type ScheduleItem,
} from "./schedule-model";

type Tab = "all" | "once" | "routines";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "once", label: "Once" },
  { id: "routines", label: "Routines" },
];

function CheckCircle({ checked, onClick, title, disabled = false }: { checked: boolean; onClick: () => void; title: string; disabled?: boolean }) {
  const circle = (
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
  );
  if (disabled) {
    return (
      <span className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full" role="img" aria-label="Completion unavailable: disabled item">
        {circle}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      aria-label={`${checked ? "Mark incomplete" : "Mark complete"}: ${title}`}
      className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {circle}
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
  const disabled = item.enabled === false;
  const titleClass = `truncate text-[15px] font-semibold leading-5 ${checked ? "line-through decoration-border" : ""}`;
  const title = item.href ? (
    <a href={item.href} className={`${titleClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}>
      {item.title}
    </a>
  ) : (
    <span className={titleClass}>{item.title}</span>
  );
  const detail = item.cadence;

  return (
    <article className={`schedule-card ${checked ? "opacity-70" : ""} ${disabled ? "opacity-50" : ""}`}>
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
            {disabled && <span className="text-text-muted">• Disabled</span>}
            <span className="text-text-muted">• {detail}</span>
          </p>
        </div>
        <CheckCircle checked={checked} onClick={() => onToggle(item.id)} title={item.title} disabled={disabled} />
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

export default function ScheduleApp({ initial }: { initial?: ScheduleData }) {
  const [schedule, setSchedule] = useState<ScheduleData>(() => {
    const dehydrated = typeof window !== "undefined" ? window.__REACT_DATA__?.schedule : undefined;
    const base = dehydrated && typeof dehydrated === "object"
      ? dehydrated as ScheduleData
      : initial ?? emptySchedule(todayKey());
    return applyLocalAdds(base, readLocalAdds(base.date));
  });
  const [tab, setTab] = useState<Tab>("all");
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

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
          const loaded = payload.data as ScheduleData;
          setSchedule(applyLocalAdds(loaded, readLocalAdds(loaded.date)));
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
    const message = takeScheduleNotice();
    if (message) setNotice(message);
  }, []);

  useEffect(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(`schedule:completed:${schedule.date}`) : null;
      const ids = raw ? JSON.parse(raw) : [];
      setCompleted(new Set(Array.isArray(ids) ? ids.map(String) : []));
    } catch {
      setCompleted(new Set());
    }
  }, [schedule.date]);

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
        <nav aria-label="Breadcrumb" className="mb-md flex flex-wrap items-center gap-2">
          <a href="/" className="text-xs text-accent-collaboration hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Home</a>
          <span className="text-text-muted" aria-hidden="true">/</span>
          <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.02em] font-display text-balance text-text-primary">Schedule</h1>
          <span className="ml-auto text-xs font-medium tabular-nums text-text-muted" aria-live="polite">
            {schedule.countToday} today
          </span>
        </nav>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className={eyebrow}>{headerDate(schedule.date)}</p>
          <a
            href="/my/projects?from=schedule-add"
            aria-label="Add schedule item — choose a project"
            title="Add schedule item — choose a project"
            data-testid="schedule-add"
            className="schedule-add fixed bottom-[calc(20px+env(safe-area-inset-bottom))] right-[calc(20px+env(safe-area-inset-right))] z-20 flex h-14 w-14 items-center justify-center rounded-[20px] bg-accent-collaboration text-white shadow-[0_12px_28px_-10px_rgba(11,101,96,.45)] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:static md:ml-auto md:h-11 md:w-11 md:rounded-[14px] md:bg-transparent md:text-text-muted md:shadow-none md:ring-1 md:ring-border md:translate-y-0 md:hover:translate-y-0 md:hover:bg-surface md:hover:text-text-primary"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 md:h-5 md:w-5" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
            </svg>
          </a>
        </div>

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
                    const active = schedule.routines.some((routine) => routine.enabled !== false && routine.days.includes(index));
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

              {visibleItems.length > 0 && (
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
                    const disabled = routine.enabled === false;
                    const titleClass = `text-[15px] font-semibold leading-5${disabled ? " text-text-muted" : ""}`;
                    const detail = routine.endsOn ? `${routine.cadence} · Ends ${shortDate(routine.endsOn)}` : routine.cadence;
                    return (
                      <article key={routine.id} className={`schedule-card ${disabled ? "opacity-50" : ""}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            {routine.href ? (
                              <a href={routine.href} className={`${titleClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}>
                                {routine.title}
                              </a>
                            ) : (
                              <span className={titleClass}>{routine.title}</span>
                            )}
                            <p className="mt-2 text-xs leading-4 text-text-muted">
                              <span className="font-code tabular-nums">{routine.time}</span> • {detail}
                              {disabled && <span> • Disabled</span>}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5" aria-label={`Runs on ${routine.days.map((day) => WEEKDAYS[day]).join(", ")}`}>
                            {DAY_LETTERS.map((letter, index) => (
                              <DayPill key={`${routine.id}-${index}`} label={letter ?? ""} active={!disabled && routine.days.includes(index)} today={index === todayIndex} />
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
    </>
  );
}
