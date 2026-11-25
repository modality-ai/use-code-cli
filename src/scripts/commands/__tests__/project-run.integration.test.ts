import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunMockModule } from "modality-bun-kit";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

const home = mkdtempSync(join(tmpdir(), "use-code-cli-cli-inproc-"));

const actualOs = await import("node:os");

// Installed before sessions/cliConfig import so PROJECTS_DIR points at temp HOME.
const resetOs = await bunMockModule("node:os", () => ({ ...actualOs, homedir: () => home }), import.meta.dir);

const actualPty = await import("../../../lib/pty");

function fakeSpawnPty(command: string, cwd: string, onData?: (data: Uint8Array) => void) {
  const text = command.startsWith("echo ")
    ? command.slice(5)
    : command === "pwd"
      ? cwd
      : "file";
  queueMicrotask(() => onData?.(new TextEncoder().encode(`${text}\n`)));
  return {
    pid: 424242,
    exitCode: 0,
    exited: Promise.resolve(0),
    terminal: { write: (data: string) => data, close: () => {} },
  } as unknown as import("../../../lib/pty").PtyProc;
}

// Must be installed before the command registry is imported by the runner.
const resetPty = await bunMockModule("../../../lib/pty", () => ({ ...actualPty, spawnPty: fakeSpawnPty }), import.meta.dir);

const realProjects = await import("../../../lib/projects.ts?perf-integration=1");
const resetProjects = await bunMockModule("../../../lib/projects", () => ({ ...realProjects, readProjects: realProjects.readProjects }), import.meta.dir);

const { PROJECTS_DIR } = await import("../../../lib/sessions");
const { setPtyJobPersistenceEnabled } = actualPty;
const { createCliRunner } = await import("modality-cli-kit");
const { cliConfig } = await import("../../../config/cliConfig");
const { normalizeCliArgv } = await import("../../../lib/cli-argv");

const runner = createCliRunner({ ...cliConfig });
const stringify = (value: unknown): string => typeof value === "string" ? value : inspect(value);

async function invoke(...argv: string[]) {
  const { argv: normalized, error } = await normalizeCliArgv(argv);
  if (error) return { code: 1, out: error };

  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.log = (...args: unknown[]) => { output.push(args.map(stringify).join(" ")); };
  console.error = (...args: unknown[]) => { output.push(args.map(stringify).join(" ")); };

  try {
    const code = await runner.run(normalized);
    return { code, out: output.join("\n") };
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
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  setPtyJobPersistenceEnabled(false);
});

afterAll(() => {
  setPtyJobPersistenceEnabled(true);
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  resetProjects();
  resetPty();
  resetOs();
});

describe("project run CLI wiring (in-process)", () => {
  it("entrypoint delegates to runCli", () => {
    const source = readFileSync(join(originalCwd, "src/runner/cli.ts"), "utf8");
    expect(source).toContain("process.exit(await runCli())");
  });

  it("runs a command via nested syntax with --", async () => {
    const res = await invoke("project", "run", "--", "echo", "hello");
    expect(res.code).toBe(0);
    expect(res.out).toContain("hello");
  });

  it("runs a command in the current cwd via nested syntax", async () => {
    const res = await invoke("project", "run", "pwd");
    expect(res.code).toBe(0);
    expect(res.out).toContain(home);
  });

  it("supports --- separator with child flags", async () => {
    const res = await invoke("project-run", "---", "ls", "-la");
    expect(res.code).toBe(0);
  });

  it("honors --project through the real parser", async () => {
    const dir = join(home, "cli-project");
    mkdirSync(dir, { recursive: true });
    const res = await invoke("project-run", "--project", dir, "--", "echo", "from-project");
    expect(res.code).toBe(0);
    expect(res.out).toContain("from-project");
  });

  it("rejects a trailing --project without a value", async () => {
    const res = await invoke("project-run", "--project");
    expect(res.code).not.toBe(0);
  });

  it("preserves project command behavior", async () => {
    const dir = join(PROJECTS_DIR, "w-proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.jsonl"), JSON.stringify({ cwd: "/w/proj", type: "summary" }) + "\n");
    const res = await invoke("project", "/w/proj");
    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/proj");
  });
});
