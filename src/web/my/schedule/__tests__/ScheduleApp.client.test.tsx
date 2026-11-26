import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { act, render } from "reshow-unit";
import ScheduleApp from "../ScheduleApp.client";
import type { ScheduleData } from "../schedule-model";
import { clearScheduleStorage, query } from "./helpers";

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
  clearScheduleStorage();
});

afterEach(() => {
  cleanup();
  clearScheduleStorage();
  globalThis.fetch = originalFetch;
});

const mount = async (initial: ScheduleData = schedule) => {
  let result: ReturnType<typeof render>;
  await act(() => { result = render(<ScheduleApp initial={initial} />); });
  return result!;
};

describe("schedule add affordance", () => {
  it("links the FAB to the project picker with explicit two-step wording", async () => {
    const result = await mount();
    const container = result.container as HTMLElement;
    const add = container.querySelector('[data-testid="schedule-add"]') as HTMLAnchorElement;
    expect(add).not.toBeNull();
    expect(add.tagName).toBe("A");
    expect(add.getAttribute("href")).toBe("/my/projects?from=schedule-add");
    expect(add.getAttribute("aria-label")).toBe("Add schedule item — choose a project");
    expect(add.getAttribute("title")).toBe("Add schedule item — choose a project");
    expect(add.querySelector("svg")).not.toBeNull();
    expect(add.className).toContain("md:h-11");
    expect(container.querySelector('[data-testid="schedule-create-trigger"]')).toBeNull();
    expect(query(container, '[role="dialog"]')).toBeNull();
  });
});

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

  it("renders a keyboard-accessible Home breadcrumb with the Schedule heading", async () => {
    const { container } = await mount();
    const nav = container.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
    expect(nav).not.toBeNull();
    const home = [...nav.querySelectorAll('a[href="/"]')].find(
      (node) => node.textContent === "Home",
    ) as HTMLAnchorElement;
    expect(home).not.toBeNull();
    expect(home.tagName).toBe("A");
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).toBe("Home");
    expect(home.className).toContain("text-xs text-accent-collaboration hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus");
    const separator = [...nav.querySelectorAll('span[aria-hidden="true"]')].find(
      (node) => node.textContent === "/",
    ) as HTMLElement;
    expect(separator).not.toBeNull();
    const h1 = nav.querySelector("h1") as HTMLElement;
    expect(h1).not.toBeNull();
    expect(h1.textContent).toBe("Schedule");
    expect(h1.className).toContain("text-[28px] font-semibold leading-8 tracking-[-0.02em] font-display text-balance text-text-primary");
    expect(nav.querySelectorAll('span[aria-hidden="true"]').length).toBe(1);
    expect(nav.lastElementChild?.getAttribute("aria-live")).toBe("polite");
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

  it("merges a local add written by the standalone add page", async () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([{
      id: "local-from-add-page",
      title: "From add page",
      kind: "once",
      project: "alpha",
      targetDate: schedule.date,
      item: {
        id: "local-from-add-page",
        sessionId: "alpha",
        sessionName: "alpha",
        title: "From add page",
        time: "09:30",
        kind: "once",
        cadence: "Today only",
        days: [0],
        completed: false,
        href: "/my/project/alpha",
        project: "alpha",
      },
    }]));
    const { container } = await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("From add page");
    expect(text).toContain("3 today");
  });

  it("keeps local adds visible when the schedule request fails", async () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([{
      id: "local-offline",
      title: "Offline item",
      kind: "once",
      project: "alpha",
      targetDate: schedule.date,
      item: {
        id: "local-offline",
        sessionId: "alpha",
        sessionName: "alpha",
        title: "Offline item",
        time: "09:30",
        kind: "once",
        cadence: "Today only",
        days: [0],
        completed: false,
        href: "/my/project/alpha",
        project: "alpha",
      },
    }]));
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ success: false }),
    })) as typeof fetch;

    const { container } = await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Could not load the schedule");
    expect(text).toContain("Offline item");
    expect(text).toContain("3 today");
  });

  it("marks disabled entries as muted and Disabled, excludes them from today count and dots, and blocks completion", async () => {
    window.localStorage.setItem("schedule:local-adds", JSON.stringify([
      {
        id: "disabled-once", title: "Disabled once", kind: "once", project: "alpha",
        targetDate: schedule.date,
        item: {
          id: "disabled-once", sessionId: "alpha", sessionName: "alpha", title: "Disabled once",
          time: "09:30", kind: "once", cadence: "Today only", days: [0], completed: false,
          href: "/my/project/alpha", enabled: false,
        },
        enabled: false,
      },
      {
        id: "disabled-routine", title: "Disabled routine", kind: "routine", project: "alpha",
        targetDate: schedule.date,
        item: {
          id: "disabled-routine", sessionId: "alpha", sessionName: "alpha", title: "Disabled routine",
          time: "08:30", kind: "routine", cadence: "Daily", days: [0], completed: false,
          href: "/my/project/alpha", enabled: false,
        },
        routine: {
          id: "disabled-routine", sessionId: "alpha", title: "Disabled routine",
          time: "08:30", cadence: "Daily", days: [0], href: "/my/project/alpha", enabled: false,
        },
        enabled: false,
      },
    ]));
    const empty: ScheduleData = { date: schedule.date, countToday: 0, items: [], routines: [] };
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: empty }),
    })) as typeof fetch;
    const reactData = window as unknown as { __REACT_DATA__?: Record<string, unknown> };
    const previousReactData = reactData.__REACT_DATA__;
    reactData.__REACT_DATA__ = { schedule: empty };
    const { container } = await mount(empty);
    expect(container.textContent).toContain("0 today");
    expect(container.textContent).toContain("Disabled once");
    expect(container.textContent).toContain("Disabled routine");
    const articles = [...container.querySelectorAll("article")];
    expect(articles).toHaveLength(2);
    for (const article of articles) {
      expect(article.textContent).toContain("Disabled");
      expect(article.className).toContain("opacity-50");
    }
    const completionButtons = [
      ...container.querySelectorAll('button[aria-label^="Mark complete"], button[aria-label^="Mark incomplete"]'),
    ];
    expect(completionButtons).toHaveLength(0);
    const activeDots = [...container.querySelectorAll('[aria-label*="active routine day"]')];
    expect(activeDots).toHaveLength(0);
    reactData.__REACT_DATA__ = previousReactData;
  });
});

