import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunMockModule } from "modality-bun-kit";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

const home = join(tmpdir(), "use-code-cli-perf-commands");
mkdirSync(home, { recursive: true });

// Pin project/session discovery to temp HOME with scoped, restorable mocks.
const actualOs = await import("node:os");
const resetOs = await bunMockModule("node:os", () => ({ ...actualOs, homedir: () => home }), import.meta.dir);

const freshSessions = await import("../../../lib/sessions.ts?perf-projects=1");
const resetSessions = await bunMockModule("../../../lib/sessions", () => freshSessions, import.meta.dir);

const realProjects = await import("../../../lib/projects.ts?perf-projects=1");
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
  const sessionsDir = join(home, ".claude", "sessions");
  const projectsDir = join(home, ".claude", "projects");
  rmSync(sessionsDir, { recursive: true, force: true });
  rmSync(projectsDir, { recursive: true, force: true });
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  let seq = 0;

  function addProject(cwd: string, sessionIds: string[], updatedAt = Date.now()) {
    const dir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const path = join(projectsDir, dir);
    mkdirSync(path, { recursive: true });
    for (const id of sessionIds) {
      const file = join(path, `${id}.jsonl`);
      writeFileSync(file, JSON.stringify({ cwd, type: "summary" }) + "\n");
      utimesSync(file, updatedAt / 1000, updatedAt / 1000);
    }
    return { dir, path };
  }

  // A live record only needs a PID that is still alive; this process qualifies.
  function addSession(name: string, cwd: string) {
    seq += 1;
    const pid = process.pid;
    writeFileSync(
      join(sessionsDir, `${pid}-${seq}.json`),
      JSON.stringify({
        pid,
        sessionId: `session-${pid}-${seq}`,
        name,
        cwd,
        status: "idle",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }

  async function run(...args: string[]) {
    return invoke(...args);
  }

  return { addProject, addSession, run };
}

describe("projects", () => {
  it("lists each project with its session count", async () => {
    const h = setup();
    h.addProject("/w/use-design", ["a", "b"]);
    h.addProject("/w/use-stock", ["c"]);

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/use-design");
    expect(res.out).toContain("2 sessions");
    expect(res.out).toContain("/w/use-stock");
    expect(res.out).toContain("1 session");
  });

  it("decodes the workspace path from the transcript, not the lossy directory name", async () => {
    const h = setup();
    h.addProject("/Users/a/my.app", ["a"]);

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/Users/a/my.app");
  });

  it("counts live sessions as active", async () => {
    const h = setup();
    h.addProject("/w/alpha", ["s1"]);
    h.addSession("alpha", "/w/alpha");

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/alpha  1 session  1 active");
  });

  it("sorts projects by newest activity first", async () => {
    const h = setup();
    const now = Date.now();
    h.addProject("/w/older", ["a"], now - 60_000);
    h.addProject("/w/newer", ["b"], now);

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out.indexOf("/w/newer")).toBeLessThan(res.out.indexOf("/w/older"));
  });

  it("reports when there are no projects", async () => {
    const h = setup();

    const res = await h.run("projects");

    expect(res.code).toBe(0);
    expect(res.out).toContain("No projects found");
  });

  it("exposes structured rows with --json", async () => {
    const h = setup();
    h.addProject("/w/alpha", ["a", "b"]);

    const res = await h.run("projects", "--json");
    const payload = JSON.parse(res.out);

    expect(res.code).toBe(0);
    expect(payload.success).toBe(true);
    expect(payload.data[0]).toMatchObject({
      cwd: "/w/alpha",
      sessions: 2,
      active: 0,
    });
  });
});
