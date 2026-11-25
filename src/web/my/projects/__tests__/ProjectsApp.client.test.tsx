import React from "react";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import { act, render } from "reshow-unit";
import ProjectsApp from "../ProjectsApp.client";

const originalReactData = window.__REACT_DATA__;
const projects = [
  { dir: "alpha/repo", cwd: "/w/alpha/repo", sessions: 2, active: 1 },
  { dir: "beta/repo", cwd: "/w/beta/repo", sessions: 1, active: 0 },
];

const query = (container: HTMLElement, selector: string) => container.querySelector(selector) as HTMLElement | null;

afterEach(() => {
  cleanup();
  (window as any).__REACT_DATA__ = originalReactData;
});

describe("ProjectsApp schedule picker", () => {
  it("shows a picker heading, back link, filter, and per-card add links", () => {
    (window as any).__REACT_DATA__ = undefined;
    const result = render(<ProjectsApp initial={projects} fromScheduleAdd />);
    const container = result.container as HTMLElement;
    expect(container.querySelector("h1")?.textContent).toBe("Choose a project for a new schedule item");
    expect(query(container, 'a[href="/my/schedule"]')).not.toBeNull();
    expect(query(container, "#project-filter")).not.toBeNull();

    const addLinks = [...container.querySelectorAll('a[href^="/my/schedule/add?project="]')];
    expect(addLinks.length).toBe(2);
    expect(addLinks[0]?.getAttribute("href")).toBe("/my/schedule/add?project=alpha%2Frepo");
    expect(addLinks[1]?.getAttribute("href")).toBe("/my/schedule/add?project=beta%2Frepo");
  });

  it("filters the long project list by path", async () => {
    (window as any).__REACT_DATA__ = undefined;
    const result = render(<ProjectsApp initial={projects} fromScheduleAdd />);
    const container = result.container as HTMLElement;
    const filter = query(container, "#project-filter") as HTMLInputElement;
    const EventCtor = (filter.ownerDocument.defaultView as any)?.Event ?? Event;
    await act(() => {
      filter.value = "beta";
      filter.dispatchEvent(new EventCtor("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("beta/repo");
    expect(container.textContent).not.toContain("alpha/repo");
    expect(container.querySelectorAll('a[href^="/my/schedule/add?project="]').length).toBe(1);
  });

  it("keeps the ordinary projects list unchanged", () => {
    (window as any).__REACT_DATA__ = undefined;
    const result = render(<ProjectsApp initial={projects} />);
    const container = result.container as HTMLElement;
    expect(container.querySelector("h1")?.textContent).toBe("Projects");
    expect(query(container, 'a[href="/my/schedule"]')).toBeNull();
    expect(query(container, "#project-filter")).toBeNull();
    expect(container.querySelectorAll('a[href^="/my/schedule/add?project="]').length).toBe(0);
  });
});
