import React, { useEffect, useMemo, useRef, useState } from "react";
import { cronSummary, cronTime, cronWeekdays, isCronValid, nextCronRuns, normalizeCron, splitCron, timeCron } from "../../../lib/cron";
import { addDays, DAY_LETTERS, monthAbbrev, parseDate, shortDate, WEEKDAYS } from "../../../lib/schedule-date";
import { eyebrow, type CreateKind, type ScheduleItem, type ScheduleRoutine, type ScheduleSaved } from "./schedule-model";

export interface ScheduleCreateFormProps {
  date: string;
  project: string;
  onSave: (saved: ScheduleSaved) => void;
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
    <fieldset className="mt-4">
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
    <div className="mt-4 flex flex-col gap-2">
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
  const month = monthAbbrev(date.getMonth());
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

export default function ScheduleCreateForm({ date, project, onSave }: ScheduleCreateFormProps) {
  const [createKind, setCreateKind] = useState<CreateKind>("once");
  const [what, setWhat] = useState("");
  const [session, setSession] = useState("");
  const [when, setWhen] = useState<"today" | "tomorrow" | "pick">("today");
  const [pickDate, setPickDate] = useState(date);
  const [time, setTime] = useState("09:00");
  const [repeats, setRepeats] = useState<"daily" | "weekly" | "cron">("daily");
  const [weekDays, setWeekDays] = useState<number[]>([1, 3, 5]);
  const [cronRule, setCronRule] = useState("30 7 * * 1-5");
  const [ends, setEnds] = useState("Never");
  const [endDate, setEndDate] = useState(date);
  const [enabled, setEnabled] = useState(true);

  const whatRef = useRef<HTMLInputElement>(null);
  const localSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => whatRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  const endInvalid = createKind === "routine" && ends === "On a date" && (!endDate || endDate < date);
  const pickInvalid = createKind === "once" && when === "pick" && (!/^\d{4}-\d{2}-\d{2}$/.test(pickDate) || pickDate < date);
  const timeRequired = createKind === "once" || repeats !== "cron";
  const timeInvalid = timeRequired && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  const canSave = what.trim().length > 0 && !timeInvalid && !pickInvalid && !(
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
    const itemTitle = what.trim();
    if (!itemTitle || !canSave) return;
    localSeq.current += 1;
    const id = `local-${Date.now()}-${localSeq.current}`;
    const projectHref = `/my/project/${encodeURIComponent(project)}`;
    const sessionValue = session.trim();

    if (createKind === "once") {
      const targetDate = when === "today" ? date : when === "tomorrow" ? addDays(date, 1) : pickDate || date;
      const cadence = when === "today" ? "Today only" : when === "tomorrow" ? "Tomorrow" : shortDate(targetDate);
      const item: ScheduleItem = {
        id,
        sessionId: sessionValue || project,
        sessionName: sessionValue || project,
        title: itemTitle,
        time,
        kind: "once",
        cadence,
        days: [parseDate(targetDate).getDay()],
        completed: false,
        href: projectHref,
        project,
        enabled,
      };
      onSave({ id, title: itemTitle, kind: "once", project, item, targetDate, enabled });
      return;
    }

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
      sessionId: sessionValue || project,
      title: itemTitle,
      time: effectiveTime,
      cadence,
      days,
      href: projectHref,
      ends,
      endsOn,
      cron: expression,
      project,
      enabled,
    };
    const item: ScheduleItem = {
      id,
      sessionId: sessionValue || project,
      sessionName: sessionValue || project,
      title: itemTitle,
      time: effectiveTime,
      kind: "routine",
      cadence,
      days,
      completed: false,
      href: projectHref,
      ends,
      endsOn,
      cron: expression,
      project,
      enabled,
    };
    onSave({ id, title: itemTitle, kind: "routine", project, item, routine, targetDate: date, enabled });
  };

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); saveCreate(); }}
      className="w-full"
    >

      <div className="relative mt-4 grid h-11 grid-cols-2 rounded-[14px] bg-shell p-1" role="group" aria-label="Item type">
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 left-1 w-[calc((100%-8px)/2)] rounded-[10px] bg-surface ring-1 ring-black/5 shadow-[0_6px_14px_-8px_rgba(29,29,27,.3)] transition-transform duration-[220ms] ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none`}
          style={{ transform: `translateX(${createKind === "once" ? 0 : 100}%)` }}
        />
        {(["once", "routine"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={createKind === kind}
            onClick={() => setCreateKind(kind)}
            className={`relative z-10 cursor-pointer appearance-none rounded-[10px] border-0 bg-transparent text-sm transition-[color,background-color,transform,box-shadow] duration-[220ms] ease-[cubic-bezier(.16,1,.3,1)] hover:text-text-primary active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none motion-reduce:transform-none ${
              createKind === kind ? "font-semibold text-text-primary" : "font-medium text-text-muted hover:bg-surface/60"
            }`}
          >
            {kind === "once" ? "Once" : "Routine"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="schedule-session" className={eyebrow}>Session ID / Name</label>
        <input
          id="schedule-session"
          type="text"
          value={session}
          onInput={(event) => setSession(event.currentTarget.value)}
          placeholder="Session id or name"
          className={`${inputClass} mt-2 w-full`}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="schedule-what" className={eyebrow}>What</label>
        <input
          ref={whatRef}
          id="schedule-what"
          type="text"
          value={what}
          onInput={(event) => setWhat(event.currentTarget.value)}
          placeholder="What needs doing?"
          className={`${inputClass} mt-2 w-full`}
        />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-[12px] border border-border bg-surface px-3 py-2">
        <span id="schedule-enabled-label" className="text-sm font-medium text-text-primary">Enabled</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="schedule-enabled-label"
          data-testid="schedule-enabled-switch"
          onClick={() => setEnabled((value) => !value)}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
            enabled ? "bg-accent-collaboration" : "bg-border"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "left-0.5" : "left-[22px]"
            }`}
          />
        </button>
      </div>

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
                min={date}
                onChange={(event) => setPickDate(event.target.value)}
                aria-invalid={pickInvalid}
                aria-describedby={pickInvalid ? "schedule-pick-date-error" : undefined}
                className={`${inputClass} w-full`}
              />
              {pickInvalid && (
                <p id="schedule-pick-date-error" className="text-[11px] text-orange" role="alert">Choose today or a later date.</p>
              )}
            </FieldRow>
          )}
          <FieldRow label={<><span className="cursor-pointer" aria-hidden="true">⏱️</span> Time</>} htmlFor="schedule-time">
            <input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={`${inputClass} w-full`} />
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
            <fieldset className="mt-4">
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
                      title={WEEKDAYS[index]}
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
            <fieldset className="mt-4">
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
            <div className="mt-4 grid grid-cols-2 gap-3">
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
                minDate={date}
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
                minDate={date}
              />
            </div>
          )}
        </>
      )}

      <div className="sticky bottom-0 z-10 mt-6 border-t border-border bg-paper pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
        <button
          type="submit"
          disabled={!canSave}
          aria-describedby={!canSave ? "schedule-save-hint" : undefined}
          className={`h-12 w-full rounded-[16px] text-sm font-semibold text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
            createKind === "once"
              ? "bg-orange shadow-[0_12px_28px_-10px_rgba(168,65,12,.45)]"
              : "bg-accent-collaboration shadow-[0_12px_28px_-10px_rgba(11,101,96,.45)]"
          }`}
        >
          Add to schedule
        </button>
        {!canSave && (
          <p id="schedule-save-hint" className="mt-2 text-xs text-text-muted">
            Enter a title and fix any highlighted fields to continue.
          </p>
        )}
      </div>
    </form>
  );
}
