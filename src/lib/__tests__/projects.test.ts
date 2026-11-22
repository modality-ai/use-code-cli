import { describe, expect, it } from "bun:test";
import { describeProjects, findProject } from "../projects";

const projects = [
  { cwd: "/a/use-code-cli", dir: "use-code-cli", sessions: 1, updatedAt: 10 },
  { cwd: "/b/demo", dir: "demo", sessions: 2, updatedAt: 20 },
  { cwd: "/c/other/deep-demo", dir: "deep-demo", sessions: 1, updatedAt: 30 },
];

describe("findProject", () => {
  it("matches exact cwd", () => {
    const res = findProject(projects, "/a/use-code-cli");
    expect(res).toHaveLength(1);
    expect(res[0]?.dir).toBe("use-code-cli");
  });

  it("falls back to dir match", () => {
    const res = findProject(projects, "demo");
    expect(res).toHaveLength(1);
    expect(res[0]?.cwd).toBe("/b/demo");
  });

  it("falls back to trailing-path suffix match", () => {
    const res = findProject(projects, "deep-demo");
    expect(res).toHaveLength(1);
    expect(res[0]?.cwd).toBe("/c/other/deep-demo");
  });

  it("returns empty when nothing matches", () => {
    expect(findProject(projects, "nope")).toEqual([]);
    expect(findProject([], "demo")).toEqual([]);
  });

  it("collapses duplicate records resolving to the same workspace", () => {
    const dupes = [
      { cwd: "/a/use-code-cli", dir: "use-code-cli", sessions: 1, updatedAt: 10 },
      { cwd: "/a/use-code-cli", dir: "use-code-cli-2", sessions: 2, updatedAt: 20 },
    ];
    const res = findProject(dupes, "use-code-cli");
    expect(res).toHaveLength(1);
    expect(res[0]?.sessions).toBe(3);
    expect(res[0]?.updatedAt).toBe(20);
  });

  it("returns empty for empty target", () => {
    expect(findProject(projects, "")).toEqual([]);
  });
});

describe("describeProjects", () => {
  it("renders candidate projects", () => {
    const out = describeProjects([projects[1]!]);
    expect(out).toContain("/b/demo");
    expect(out).toContain("2 sessions");
  });
});
