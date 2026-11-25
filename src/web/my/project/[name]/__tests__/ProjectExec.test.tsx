import React from "react";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import { render, screen } from "reshow-unit";
import ProjectExec from "../ProjectExec.client";

const originalReactData = (window as any).__REACT_DATA__;

afterEach(() => {
  cleanup();
  (window as any).__REACT_DATA__ = originalReactData;
});

describe("ProjectExec header", () => {
  it("renders a gear link to the project config page", () => {
    (window as any).__REACT_DATA__ = { projectExec: { name: "foo" } };
    render(React.createElement(ProjectExec, { name: "foo" }));
    const link = screen().getByLabelText("Project config");
    expect(link.getAttribute("href")).toBe("/my/project/foo/config");
    expect(link.getAttribute("title")).toBe("Project config");
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("renders an Add schedule item link after the config link", () => {
    (window as any).__REACT_DATA__ = { projectExec: { name: "foo" } };
    render(React.createElement(ProjectExec, { name: "foo" }));
    const link = screen().getByLabelText("Add schedule item");
    expect(link.getAttribute("href")).toBe("/my/schedule/add?project=foo");
    expect(link.getAttribute("title")).toBe("Add schedule item");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.querySelectorAll("svg path").length).toBeGreaterThan(2);
  });

  it("keeps the title compact on mobile with a full-title tooltip", () => {
    (window as any).__REACT_DATA__ = { projectExec: { name: "foo" } };
    const result = render(React.createElement(ProjectExec, { name: "foo" }));
    const heading = result.container.querySelector("h1") as HTMLHeadingElement;
    expect(heading.textContent).toBe("Project: foo");
    expect(heading.getAttribute("title")).toBe("Project: foo");
    expect(heading.className).toContain("min-w-0");
    expect(heading.className).toContain("truncate");
  });
});
