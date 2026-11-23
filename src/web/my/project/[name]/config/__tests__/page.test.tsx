import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as scripts from "../../../../../../scripts/index";
import ProjectConfigPage, { loadData } from "../page";

let restoreSpy: (() => void) | undefined;

afterEach(() => {
  restoreSpy?.();
  restoreSpy = undefined;
});

function mockExecute(result: unknown) {
  const spy = spyOn(scripts.aiTool, "execute").mockResolvedValue(result as never);
  restoreSpy = () => spy.mockRestore();
  return spy;
}

const sampleConfig = { dir: "d", cwd: "/c", sessions: 2, active: 1, updatedAt: null, path: "/p", po: "po" };
const successResult = { success: true, data: sampleConfig };
const notFoundResult = { success: false, message: "No project matches" };

describe("ProjectConfigPage loadData", () => {
  it("calls aiTool.execute with project command and name", async () => {
    const spy = mockExecute(successResult);
    await loadData({ name: "foo" });
    expect(spy).toHaveBeenCalledWith({ command: "project", target: "foo" });
  });

  it("uses name from props.name", async () => {
    mockExecute(successResult);
    const res = await loadData({ name: "foo" });
    expect(res.name).toBe("foo");
  });

  it("falls back to params.name", async () => {
    mockExecute(successResult);
    const res = await loadData({ params: { name: "bar" } });
    expect(res.name).toBe("bar");
  });

  it("defaults to empty string when no name given", async () => {
    mockExecute(notFoundResult);
    const res = await loadData();
    expect(res.name).toBe("");
  });
});

describe("ProjectConfigPage rendering", () => {
  it("renders project details on success", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectConfigPage, { name: "foo", data: successResult }));
    expect(html).toContain("Project config: foo");
    expect(html).toContain("cwd");
    expect(html).toContain("/c");
    expect(html).toContain("dirName");
    expect(html).toContain("d");
    expect(html).toContain("2 sessions (1 active)");
    expect(html).toContain("active");
    expect(html).toContain("updated");
    expect(html).toContain("—");
    expect(html).toContain('id="project-po"');
    expect(html).toContain('aria-label="Project PO"');
    expect(html).toContain("Save");
    expect(html).toContain("path");
    expect(html).toContain("/p");
    expect(html).toContain("/my/project/foo");
  });

  it("renders not-found message and link on failure", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectConfigPage, { name: "foo", data: notFoundResult }));
    expect(html).toContain("No project matches");
    expect(html).toContain("/my/project/foo");
  });
});
