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
});
