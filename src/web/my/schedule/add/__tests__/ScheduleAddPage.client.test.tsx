import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { act, render } from "reshow-unit";
import { readLocalAdds, takeScheduleNotice } from "../../schedule-model";
import {
  clearScheduleStorage,
  clickButton,
  query,
  setFieldValue,
  submitButton,
  typeInto,
} from "../../__tests__/helpers";
import ScheduleAddPage from "../ScheduleAddPage.client";

const date = "2026-11-22";
let navigated: string | null = null;

beforeEach(() => {
  navigated = null;
  clearScheduleStorage();
});

afterEach(() => {
  cleanup();
  clearScheduleStorage();
});

const mount = async (project: string | null = "foo") => {
  let result: ReturnType<typeof render>;
  await act(() => {
    result = render(<ScheduleAddPage date={date} project={project ?? undefined} navigate={(href) => { navigated = href; }} />);
  });
  return result!;
};

describe("schedule add page", () => {
  it("renders one exit, one heading, and an accessible standalone form", async () => {
    const { container } = await mount();
    const text = container.textContent ?? "";
    const backLinks = [...container.querySelectorAll('a[href="/my/projects?from=schedule-add"]')];
    expect(backLinks.length).toBe(1);
    expect(container.querySelector("h1")?.textContent).toBe("Add schedule item");
    expect(query(container, '[data-testid="selected-project"]')?.textContent).toBe("Project: foo");
    expect(text).not.toContain("Cancel");
    expect(text).not.toContain("New item");
    expect(query(container, '[role="dialog"]')).toBeNull();
    expect(query(container, '[role="tablist"][aria-label="Item type"]')).toBeNull();
    expect(query(container, '[role="group"][aria-label="Item type"]')).not.toBeNull();

    const whatLabel = query(container, 'label[for="schedule-what"]') as HTMLLabelElement;
    expect(whatLabel).not.toBeNull();
    expect(whatLabel.textContent).toBe("What");

    const save = submitButton(container);
    expect(save.textContent).toBe("Add to schedule");
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-describedby")).toBe("schedule-save-hint");
    expect(text).toContain("Enter a title and fix any highlighted fields to continue.");
    expect(save.parentElement?.className).toContain("sticky");
    expect(save.className).toContain("bg-orange");

    await act(() => { typeInto(query(container, "#schedule-what") as HTMLInputElement, "Pay the bills"); });
    expect(save.disabled).toBe(false);
    expect(query(container, "#schedule-save-hint")).toBeNull();
  });

  it("submits a Once item, shows a notice, and navigates back", async () => {
    const { container } = await mount();
    await act(() => { typeInto(query(container, "#schedule-what") as HTMLInputElement, "Pay the bills"); });
    await act(() => { submitButton(container).click(); });

    expect(navigated).toBe("/my/schedule");
    const adds = readLocalAdds(date);
    expect(adds.length).toBe(1);
    expect(adds[0]?.title).toBe("Pay the bills");
    expect(adds[0]?.kind).toBe("once");
    expect(adds[0]?.project).toBe("foo");
    expect(adds[0]?.targetDate).toBe(date);
    expect(adds[0]?.item.sessionId).toBe("foo");
    expect(adds[0]?.item.sessionName).toBe("foo");
    expect(adds[0]?.item.href).toBe("/my/project/foo");
    expect(takeScheduleNotice()).toContain("for foo");
  });

  it("switches to routine fields and a teal Add button", async () => {
    const { container } = await mount();
    await clickButton(container, "Routine");
    const text = container.textContent ?? "";
    expect(text).toContain("Repeats");
    expect(text).toContain("Daily");
    expect(text).toContain("Weekly");
    expect(text).toContain("Cron");
    expect(text).toContain("Time");
    expect(text).toContain("Ends");
    expect(text).toContain("Never");
    expect(text).toContain("Every day at 09:00");
    expect(text).toContain("Next runs");
    expect(text).toContain("Cron equivalent");
    expect(text).toContain("0 9 * * *");
    expect(submitButton(container).className).toContain("bg-accent-collaboration");
  });

  it("renders weekly day pills, summary, and cron equivalent", async () => {
    const { container } = await mount();
    await clickButton(container, "Routine");
    await clickButton(container, "Weekly");
    const text = container.textContent ?? "";
    expect(text).toContain("On");
    expect(text).toContain("Every Mon, Wed, Fri at 09:00");
    expect(text).toContain("Next runs");
    expect(text).toContain("Cron equivalent");
    expect(text).toContain("0 9 * * 1,3,5");
    expect((query(container, 'button[aria-label="Monday"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((query(container, 'button[aria-label="Sunday"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
  });

  it("renders cron chips, live summary, and validation", async () => {
    const { container } = await mount();
    await clickButton(container, "Routine");
    await clickButton(container, "Cron");
    const text = container.textContent ?? "";
    expect(text).toContain("Cron rule");
    expect(text).toContain("* any");
    expect(text).toContain("min");
    expect(text).toContain("hour");
    expect(text).toContain("weekday");
    expect(text).toContain("At 07:30, Monday to Friday");
    expect(text).toContain("Next runs");
    expect(text).toContain("Ends");

    const ruleInput = query(container, "#schedule-cron") as HTMLInputElement;
    expect(ruleInput.value).toBe("30 7 * * 1-5");
    expect(ruleInput.getAttribute("aria-invalid")).toBe("false");
    await act(() => { typeInto(ruleInput, "bad"); });
    expect(ruleInput.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Enter a valid 5-field cron rule");
    expect(submitButton(container).disabled).toBe(true);
  });

  it("validates and stores the routine end date", async () => {
    const { container } = await mount();
    await clickButton(container, "Routine");
    await act(() => { typeInto(query(container, "#schedule-what") as HTMLInputElement, "Language course"); });
    const ends = query(container, "#schedule-ends") as HTMLSelectElement;
    expect([...ends.options].map((option) => option.value)).toEqual(["Never", "On a date"]);
    expect(container.textContent).not.toContain("After 4 weeks");
    await act(() => { setFieldValue(ends, "On a date"); });

    const endDate = query(container, "#schedule-end-date") as HTMLInputElement;
    expect(endDate.value).toBe(date);
    expect(endDate.getAttribute("min")).toBe(date);
    const endsCard = query(container, '[data-testid="ends-control"]')!;
    expect(endsCard.contains(ends)).toBe(true);
    expect(endsCard.contains(endDate)).toBe(true);
    const dateLabel = query(container, 'label[for="schedule-end-date"]') as HTMLLabelElement;
    expect(dateLabel.textContent).toBe("Ends on date");
    expect(dateLabel.parentElement).toBe(endDate.parentElement);

    await act(() => { setFieldValue(endDate, "2026-11-21"); });
    expect(container.textContent).toContain("Choose today or a later date.");
    expect(endDate.getAttribute("aria-invalid")).toBe("true");
    expect(submitButton(container).disabled).toBe(true);

    await act(() => { setFieldValue(endDate, "2026-12-01"); });
    expect(endDate.getAttribute("aria-invalid")).toBe("false");
    expect(submitButton(container).disabled).toBe(false);
    await act(() => { submitButton(container).click(); });

    expect(navigated).toBe("/my/schedule");
    const adds = readLocalAdds(date);
    expect(adds.length).toBe(1);
    expect(adds[0]?.kind).toBe("routine");
    expect(adds[0]?.project).toBe("foo");
    if (adds[0]?.kind === "routine") {
      expect(adds[0].routine.endsOn).toBe("2026-12-01");
      expect(adds[0].routine.sessionId).toBe("foo");
      expect(adds[0].routine.href).toBe("/my/project/foo");
    }
  });

  it("limits routine preview runs to the inclusive end date", async () => {
    const { container } = await mount();
    await clickButton(container, "Routine");
    await act(() => { setFieldValue(query(container, "#schedule-ends") as HTMLSelectElement, "On a date"); });
    await act(() => { setFieldValue(query(container, "#schedule-end-date") as HTMLInputElement, "2026-11-25"); });
    expect(container.textContent).toContain("Wed 25 Nov • 09:00");
    expect(container.textContent).not.toContain("Thu 26 Nov • 09:00");
  });

  it("adds a daily routine locally", async () => {
    const { container } = await mount();
    await clickButton(container, "Routine");
    await act(() => { typeInto(query(container, "#schedule-what") as HTMLInputElement, "Evening walk"); });
    await act(() => { submitButton(container).click(); });

    expect(navigated).toBe("/my/schedule");
    const adds = readLocalAdds(date);
    expect(adds.length).toBe(1);
    expect(adds[0]?.kind).toBe("routine");
    if (adds[0]?.kind === "routine") expect(adds[0].routine.cadence).toBe("Daily");
  });

  it("redirects to the project picker when no project is selected", async () => {
    const { container } = await mount(null);
    expect(navigated).toBe("/my/projects?from=schedule-add");
    expect(container.textContent).toContain("Choose a project first");
    expect(container.textContent).toContain("Redirecting to the picker");
    expect(query(container, "#schedule-what")).toBeNull();
    expect(readLocalAdds(date).length).toBe(0);
  });
});
