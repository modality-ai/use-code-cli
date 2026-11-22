import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { act, render } from "reshow-unit";
import ScheduleApp from "../ScheduleApp.client";

const schedule = {
  date: "2026-11-22",
  countToday: 2,
  items: [
    {
      id: "routine-1",
      sessionId: "s1",
      sessionName: "alpha",
      title: "Morning stretch",
      time: "08:00",
      kind: "routine" as const,
      cadence: "Daily",
      days: [0, 1, 2, 3, 4, 5, 6],
      completed: false as const,
      href: "/my/session/s1",
    },
    {
      id: "once-1",
      sessionId: "s1",
      sessionName: "alpha",
      title: "Call the landlord",
      time: "10:00",
      kind: "once" as const,
      cadence: "Today only",
      days: [0],
      completed: false as const,
      href: "/my/session/s1",
    },
  ],
  routines: [
    {
      id: "routine-1",
      sessionId: "s1",
      title: "Morning stretch",
      time: "08:00",
      cadence: "Daily",
      days: [0, 1, 2, 3, 4, 5, 6],
      href: "/my/session/s1",
    },
  ],
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: schedule }),
  })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const mount = async () => {
  let result: ReturnType<typeof render>;
  await act(() => { result = render(<ScheduleApp initial={schedule} />); });
  return result!;
};

const openCreate = async (container: HTMLElement) => {
  const addButton = container.querySelector('button[aria-controls="schedule-create"]') as HTMLButtonElement;
  expect(addButton).not.toBeNull();
  await act(() => { addButton.click(); });
};

const chooseRepeat = async (container: HTMLElement, label: string) => {
  const dialog = query(container, '[role="dialog"]')!;
  const button = [...dialog.querySelectorAll("button")].find((node) => node.textContent === label) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(() => { button.click(); });
};

const query = (container: HTMLElement, selector: string) => container.querySelector(selector) as HTMLElement | null;

const typeInto = (input: HTMLInputElement, value: string) => {
  input.value = value;
  const EventCtor = (input.ownerDocument.defaultView as any)?.Event ?? Event;
  input.dispatchEvent(new EventCtor("input", { bubbles: true }));
  input.dispatchEvent(new EventCtor("change", { bubbles: true }));
};

const setFieldValue = (field: HTMLInputElement | HTMLSelectElement, value: string) => {
  let prototype: object | null = Object.getPrototypeOf(field);
  let setter: ((value: string) => void) | undefined;
  while (prototype && !setter) {
    setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set as ((value: string) => void) | undefined;
    prototype = Object.getPrototypeOf(prototype);
  }
  if (setter) setter.call(field, value);
  else field.value = value;
  const EventCtor = (field.ownerDocument.defaultView as any)?.Event ?? Event;
  field.dispatchEvent(new EventCtor("input", { bubbles: true }));
  field.dispatchEvent(new EventCtor("change", { bubbles: true }));
};

describe("ScheduleApp", () => {
  it("renders the header, tabs, today cards, and routines", async () => {
    const { container } = await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Sunday, 22 Nov");
    expect(text).toContain("Schedule");
    expect(text).toContain("2 today");
    expect(text).toContain("All");
    expect(text).toContain("Once");
    expect(text).toContain("Routines");
    expect(text).toContain("Today");
    expect(text).toContain("Morning stretch");
    expect(text).toContain("Call the landlord");
    expect(text).toContain("Your routines");
    expect(text).toContain("Manage");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("toggles a completion circle locally", async () => {
    const { container } = await mount();
    const button = query(container, 'button[aria-label^="Mark complete"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(() => { button.click(); });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("filters the today list by tab", async () => {
    const { container } = await mount();
    const onceTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Once") as HTMLButtonElement;
    expect(onceTab).not.toBeNull();
    await act(() => { onceTab.click(); });
    const panelText = query(container, '[role="tabpanel"]')?.textContent ?? "";
    expect(panelText).toContain("Call the landlord");
    expect(panelText).not.toContain("Morning stretch");
  });
});

describe("ScheduleApp create UI", () => {
  it("opens an accessible New item dialog with Once fields", async () => {
    const { container } = await mount();
    await openCreate(container);
    const dialog = query(container, '[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const text = dialog?.textContent ?? "";
    expect(text).toContain("Cancel");
    expect(text).toContain("New item");
    expect(text).toContain("Once");
    expect(text).toContain("Routine");
    expect(text).toContain("What");
    expect(text).toContain("When");
    expect(text).toContain("Today");
    expect(text).toContain("Tomorrow");
    expect(text).toContain("Pick date");
    expect(text).toContain("Time");
    const emojis = [...dialog!.querySelectorAll("span")].filter((node) => node.textContent === "📅" || node.textContent === "⏱️");
    expect(emojis.length).toBe(2);
    for (const emoji of emojis) expect(emoji.className).toContain("cursor-pointer");
    expect(text).not.toContain("Remind me");
    expect(text).toContain("Save");
    const onceButton = [...dialog!.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Once") as HTMLButtonElement;
    const routineButton = [...dialog!.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Routine") as HTMLButtonElement;
    expect(onceButton.getAttribute("aria-pressed")).toBe("true");
    expect(onceButton.className).toContain("font-semibold");
    expect(routineButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to routine fields and a teal Save button", async () => {
    const { container } = await mount();
    await openCreate(container);
    const routineTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Routine") as HTMLButtonElement;
    await act(() => { routineTab.click(); });
    expect(routineTab.getAttribute("aria-pressed")).toBe("true");
    expect(routineTab.className).toContain("font-semibold");
    const dialog = query(container, '[role="dialog"]')!;
    const onceButton = [...dialog.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Once") as HTMLButtonElement;
    expect(onceButton.getAttribute("aria-pressed")).toBe("false");
    const dialogText = query(container, '[role="dialog"]')?.textContent ?? "";
    expect(dialogText).toContain("Repeats");
    expect(dialogText).toContain("Daily");
    expect(dialogText).toContain("Weekly");
    expect(dialogText).toContain("Cron");
    expect(dialogText).toContain("Time");
    expect(dialogText).toContain("Ends");
    expect(dialogText).toContain("Never");
    expect(dialogText).toContain("Every day at 09:00");
    expect(dialogText).toContain("Next runs");
    expect(dialogText).toContain("Cron equivalent");
    expect(dialogText).toContain("0 9 * * *");
    const save = query(container, 'button[type="submit"]') as HTMLButtonElement;
    expect(save.className).toContain("bg-accent-collaboration");
  });

  it("uses an orange Save button for Once", async () => {
    const { container } = await mount();
    await openCreate(container);
    const save = query(container, 'button[type="submit"]') as HTMLButtonElement;
    expect(save.className).toContain("bg-orange");
  });

  it("closes on Cancel", async () => {
    const { container } = await mount();
    await openCreate(container);
    const cancel = [...container.querySelectorAll("button")].find((node) => node.textContent === "Cancel") as HTMLButtonElement;
    await act(() => { cancel.click(); });
    expect(query(container, '[role="dialog"]')).toBeNull();
  });

  it("adds a once item optimistically", async () => {
    const { container } = await mount();
    await openCreate(container);
    const input = query(container, "#schedule-what") as HTMLInputElement;
    await act(() => { typeInto(input, "Pay the bills"); });
    const save = query(container, 'button[type="submit"]') as HTMLButtonElement;
    await act(() => { save.click(); });
    expect(query(container, '[role="dialog"]')).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("Pay the bills");
    expect(text).toContain("3 today");
    expect(text).toContain('Added "Pay the bills" locally.');
  });

  it("adds a daily routine optimistically", async () => {
    const { container } = await mount();
    await openCreate(container);
    const routineTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Routine") as HTMLButtonElement;
    await act(() => { routineTab.click(); });
    const input = query(container, "#schedule-what") as HTMLInputElement;
    await act(() => { typeInto(input, "Evening walk"); });
    const save = query(container, 'button[type="submit"]') as HTMLButtonElement;
    await act(() => { save.click(); });
    expect(query(container, '[role="dialog"]')).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("Evening walk");
    expect(text).toContain("Daily");
    expect(text).toContain("3 today");
  });

  it("renders weekly day pills, summary, and cron equivalent", async () => {
    const { container } = await mount();
    await openCreate(container);
    const routineTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Routine") as HTMLButtonElement;
    await act(() => { routineTab.click(); });
    await chooseRepeat(container, "Weekly");
    const dialog = query(container, '[role="dialog"]')!;
    const text = dialog.textContent ?? "";
    expect(text).toContain("On");
    expect(text).toContain("Every Mon, Wed, Fri at 09:00");
    expect(text).toContain("Next runs");
    expect(text).toContain("Cron equivalent");
    expect(text).toContain("0 9 * * 1,3,5");
    const monday = query(dialog, 'button[aria-label="Monday"]') as HTMLButtonElement;
    const sunday = query(dialog, 'button[aria-label="Sunday"]') as HTMLButtonElement;
    expect(monday.getAttribute("aria-pressed")).toBe("true");
    expect(sunday.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders cron rule chips, live summary, and validation", async () => {
    const { container } = await mount();
    await openCreate(container);
    const routineTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Routine") as HTMLButtonElement;
    await act(() => { routineTab.click(); });
    await chooseRepeat(container, "Cron");
    const dialog = query(container, '[role="dialog"]')!;
    const text = dialog.textContent ?? "";
    expect(text).toContain("Cron rule");
    expect(text).toContain("* any");
    expect(text).toContain("min");
    expect(text).toContain("hour");
    expect(text).toContain("weekday");
    expect(text).toContain("At 07:30, Monday to Friday");
    expect(text).toContain("Next runs");
    expect(text).toContain("Ends");
    const ruleInput = query(dialog, "#schedule-cron") as HTMLInputElement;
    expect(ruleInput.value).toBe("30 7 * * 1-5");
    expect(ruleInput.getAttribute("aria-invalid")).toBe("false");
    await act(() => { typeInto(ruleInput, "bad"); });
    expect(ruleInput.getAttribute("aria-invalid")).toBe("true");
    expect(dialog.textContent).toContain("Enter a valid 5-field cron rule");
    expect((query(dialog, 'button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("validates and stores the routine end date", async () => {
    const { container } = await mount();
    await openCreate(container);
    const routineTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Routine") as HTMLButtonElement;
    await act(() => { routineTab.click(); });
    const dialog = query(container, '[role="dialog"]')!;
    const what = query(dialog, "#schedule-what") as HTMLInputElement;
    await act(() => { typeInto(what, "Language course"); });
    const ends = query(dialog, "#schedule-ends") as HTMLSelectElement;
    expect([...ends.options].map((option) => option.value)).toEqual(["Never", "On a date"]);
    expect(dialog.textContent).not.toContain("After 4 weeks");
    await act(() => { setFieldValue(ends, "On a date"); });
    const endDate = query(dialog, "#schedule-end-date") as HTMLInputElement;
    expect(endDate).not.toBeNull();
    expect(endDate.value).toBe("2026-11-22");
    expect(endDate.getAttribute("min")).toBe("2026-11-22");
    const endsCard = query(dialog, '[data-testid="ends-control"]')!;
    expect(endsCard.contains(ends)).toBe(true);
    expect(endsCard.contains(endDate)).toBe(true);
    const dateLabel = query(dialog, 'label[for="schedule-end-date"]') as HTMLLabelElement;
    expect(dateLabel.textContent).toBe("Ends on date");
    expect(dateLabel.parentElement).toBe(endDate.parentElement);
    expect(endsCard.textContent).toContain("Ends on date");

    await act(() => { setFieldValue(endDate, "2026-11-21"); });
    expect(dialog.textContent).toContain("Choose today or a later date.");
    expect(endDate.getAttribute("aria-invalid")).toBe("true");
    expect((query(dialog, 'button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);

    await act(() => { setFieldValue(endDate, "2026-12-01"); });
    expect(endDate.getAttribute("aria-invalid")).toBe("false");
    expect((query(dialog, 'button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    await act(() => { (query(dialog, 'button[type="submit"]') as HTMLButtonElement).click(); });
    expect(query(container, '[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Ends Dec 1");
  });
});
