import { describe, expect, it } from "bun:test";
import { findProject } from "../exec/route";

const projects = [
  { cwd: "/a/use-code-cli", dir: "use-code-cli" },
  { cwd: "/b/demo", dir: "demo" },
  { cwd: "/c/other/deep-demo" },
];

describe("findProject", () => {
  it("matches exact cwd before dir", () => {
    expect(findProject(projects, "/a/use-code-cli")?.dir).toBe("use-code-cli");
  });

  it("falls back to basename match", () => {
    expect(findProject(projects, "demo")?.cwd).toBe("/b/demo");
  });

  it("falls back to trailing-path suffix match", () => {
    expect(findProject(projects, "deep-demo")?.cwd).toBe("/c/other/deep-demo");
  });

  it("returns undefined when nothing matches", () => {
    expect(findProject(projects, "nope")).toBeUndefined();
    expect(findProject([], "demo")).toBeUndefined();
  });

  it("returns undefined for empty name", () => {
    expect(findProject(projects, "")).toBeUndefined();
  });
});
