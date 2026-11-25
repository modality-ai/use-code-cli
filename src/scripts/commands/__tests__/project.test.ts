import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunMockModule } from "modality-bun-kit";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

const home = join(tmpdir(), "use-code-cli-perf-commands");
mkdirSync(home, { recursive: true });

const actualOs = await import("node:os");
const resetOs = await bunMockModule("node:os", () => ({ ...actualOs, homedir: () => home }), import.meta.dir);

const freshSessions = await import("../../../lib/sessions.ts?perf-project=1");
const resetSessions = await bunMockModule("../../../lib/sessions", () => freshSessions, import.meta.dir);

const realProjects = await import("../../../lib/projects.ts?perf-project=1");
const resetProjects = await bunMockModule("../../../lib/projects", () => ({ ...realProjects, readProjects: realProjects.readProjects }), import.meta.dir);

const { createCliRunner } = await import("modality-cli-kit");
const { cliConfig } = await import("../../../config/cliConfig");
const { normalizeCliArgv } = await import("../../../lib/cli-argv");

const runner = createCliRunner({ ...cliConfig });
const stringify = (value: unknown): string => typeof value === "string" ? value : inspect(value);

async function invoke(...args: string[]) {
  const { argv, error } = await normalizeCliArgv(args);
  if (error) return { code: 1, out: "", err: error };

  const out: string[] = [];
  const err: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.log = (...values: unknown[]) => { out.push(values.map(stringify).join(" ")); };
  console.error = (...values: unknown[]) => { err.push(values.map(stringify).join(" ")); };

  try {
    const code = await runner.run(argv);
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

const originalHome = process.env.HOME;
const originalCwd = process.cwd();

beforeAll(() => {
  process.env.HOME = home;
  process.chdir(home);
});

afterAll(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  resetProjects();
  resetSessions();
  resetOs();
});

function setup() {
  const projectsDir = join(home, ".claude", "projects");
  rmSync(projectsDir, { recursive: true, force: true });
  mkdirSync(projectsDir, { recursive: true });

  function addProject(cwd: string, sessionIds: string[]) {
    const dir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const path = join(projectsDir, dir);
    mkdirSync(path, { recursive: true });
    for (const id of sessionIds) {
      const file = join(path, `${id}.jsonl`);
      writeFileSync(file, JSON.stringify({ cwd, type: "summary" }) + "\n");
      utimesSync(file, Date.now() / 1000, Date.now() / 1000);
    }
    return { dir, path };
  }

  async function run(...args: string[]) {
    return invoke(...args);
  }

  return { home, projectsDir, addProject, run };
}

describe("project", () => {
  it("shows details for a known project", async () => {
    const h = setup();
    h.addProject("/w/proj", ["a", "b"]);

    const res = await h.run("project", "/w/proj");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/proj");
    expect(res.out).toContain("dirName");
    expect(res.out).toContain("sessions");
    expect(res.out).toContain("2 sessions");
  });

  it("uses a stored agent binary override", async () => {
    const h = setup();
    const { dir } = h.addProject("/w/proj", ["a"]);
    mkdirSync(join(h.home, ".use-code-cli"), { recursive: true });
    writeFileSync(
      join(h.home, ".use-code-cli", "projects.json"),
      JSON.stringify({ [dir]: { agentBin: "/custom/claude" } }),
    );

    const res = await h.run("project", "/w/proj", "--json");

    expect(res.code).toBe(0);
    expect(JSON.parse(res.out).data.agentBin).toBe("/custom/claude");
  });

  it("reports an ambiguous target", async () => {
    const h = setup();
    h.addProject("/w/proj", ["a"]);
    h.addProject("/x/proj", ["b"]);

    const res = await h.run("project", "proj");

    expect(res.code).toBe(1);
    expect(res.err + res.out).toContain("is ambiguous");
  });

  it("errors on an unknown project", async () => {
    const h = setup();

    const res = await h.run("project", "/no/such/project");

    expect(res.code).toBe(1);
    expect(res.err + res.out).toContain("No project matches");
  });

  it("falls back to an existing directory with no transcripts", async () => {
    const h = setup();
    const dir = join(h.home, "emptydir");
    mkdirSync(dir);

    const res = await h.run("project", dir);

    expect(res.code).toBe(0);
    expect(res.out).toContain(dir);
    expect(res.out).toContain("0 sessions");
  });
});
