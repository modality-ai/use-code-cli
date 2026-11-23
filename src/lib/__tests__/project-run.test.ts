import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { projectRunErrorStatus, resolveProject } from "../project-run";
import type { ProjectInfo } from "../projects";

const projectStore: { projects: ProjectInfo[] } = { projects: [] };

const fakeReadProjects = async () => projectStore.projects;

describe("resolveProject", () => {
  it("resolves a known project by name", async () => {
    projectStore.projects = [{ dir: "proj", cwd: "/w/proj", sessions: 1, updatedAt: 1 }];
    const res = await resolveProject("proj", { readProjects: fakeReadProjects });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proj.cwd).toBe("/w/proj");
  });

  it("reports ambiguity when multiple projects match", async () => {
    projectStore.projects = [
      { dir: "a", cwd: "/w/proj", sessions: 1, updatedAt: 1 },
      { dir: "b", cwd: "/x/proj", sessions: 1, updatedAt: 1 },
    ];
    const res = await resolveProject("proj", { readProjects: fakeReadProjects });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("ambiguous");
  });

  it("falls back to an existing directory on disk", async () => {
    projectStore.projects = [];
    const dir = join(tmpHome2(), "workdir");
    mkdirSync(dir, { recursive: true });
    const res = await resolveProject(dir, { readProjects: fakeReadProjects });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proj.cwd).toBe(dir);
  });

  it("returns an error when nothing matches", async () => {
    projectStore.projects = [];
    const res = await resolveProject("/no/such/dir/xyz", { readProjects: fakeReadProjects });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("No project matches");
  });
});

describe("projectRunErrorStatus", () => {
  it("maps known command failures to HTTP statuses", () => {
    expect(projectRunErrorStatus("Command required. Usage: ...")).toBe(400);
    expect(projectRunErrorStatus("too many live jobs; wait for one to finish")).toBe(429);
    expect(projectRunErrorStatus('"x" is ambiguous; use a full path')).toBe(409);
    expect(projectRunErrorStatus('No project matches "x".')).toBe(404);
    expect(projectRunErrorStatus("boom")).toBe(500);
  });
});

function tmpHome2() {
  return mkdtempSync(join(tmpdir(), "pr-"));
}
