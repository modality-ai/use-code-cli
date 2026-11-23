import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "bun:test";
import ProjectConfigPage, { loadData } from "../page";

describe("ProjectConfigPage loadData", () => {
  it("uses name from props.name", async () => {
    expect(await loadData({ name: "foo" })).toEqual({ name: "foo" });
  });

  it("falls back to params.name", async () => {
    expect(await loadData({ params: { name: "bar" } })).toEqual({ name: "bar" });
  });

  it("defaults to empty string when no name given", async () => {
    expect(await loadData()).toEqual({ name: "" });
    expect(await loadData({})).toEqual({ name: "" });
  });

  it("renders the project name", () => {
    expect(renderToStaticMarkup(React.createElement(ProjectConfigPage, { name: "foo" }))).toContain("Project config: foo");
  });
});
