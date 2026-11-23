import { describe, expect, it } from "bun:test";
import { findProject } from "../../../../../../lib/projects";

const projects = [
  { cwd: "/a/use-code-cli", dir: "use-code-cli" },
  { cwd: "/b/demo", dir: "demo" },
  { cwd: "/c/other/deep-demo" },
];

describe("findProject", () => {
  it("matches exact cwd before dir", () => {
    expect(findProject(projects, "/a/use-code-cli")[0]?.dir).toBe("use-code-cli");
  });

  it("falls back to basename match", () => {
    expect(findProject(projects, "demo")[0]?.cwd).toBe("/b/demo");
  });

  it("falls back to trailing-path suffix match", () => {
    expect(findProject(projects, "deep-demo")[0]?.cwd).toBe("/c/other/deep-demo");
  });

  it("returns an empty array when nothing matches", () => {
    expect(findProject(projects, "nope")).toEqual([]);
    expect(findProject([], "demo")).toEqual([]);
  });

  it("returns an empty array for empty name", () => {
    expect(findProject(projects, "")).toEqual([]);
  });
});
