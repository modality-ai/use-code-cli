import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunMockModule } from "modality-bun-kit";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtyProc } from "../../../lib/pty";
import { setPtyJobPersistenceEnabled } from "../../../lib/pty";
import { ProjectRunArgsSchema, type ProjectRunArgs } from "../../../lib/project-run";
import { projectRunCommand } from "../project-run";

const sharedHome = mkdtempSync(join(tmpdir(), "use-code-cli-inproc-"));

const actualPty = await import("../../../lib/pty");
const actualProjects = await import("../../../lib/projects");

let fakePid = 100000;

function fakeSpawnPty(command: string, cwd: string, onData?: (data: Uint8Array) => void): PtyProc {
  const exitCode = command.includes("false") ? 1 : 0;
  let text = "";
  if (command.includes("pwd")) text = cwd;
  else if (command.includes("echo")) text = command.slice(command.indexOf("echo") + 4).trim();
  else if (command.includes("ls")) text = "file";
  if (text) queueMicrotask(() => onData?.(new TextEncoder().encode(`${text}\n`)));
  return {
    pid: ++fakePid,
    exited: Promise.resolve(exitCode),
    exitCode,
    terminal: { write: (data: string) => data, close: () => {} },
  } as unknown as PtyProc;
}

const resetPty = await bunMockModule("../../../lib/pty", () => ({
  ...actualPty,
  spawnPty: fakeSpawnPty,
}), import.meta.dir);

// Keep discovery empty so tests never scan the developer's real projects dir.
const resetProjects = await bunMockModule("../../../lib/projects", () => ({
  ...actualProjects,
  readProjects: async () => [],
}), import.meta.dir);

beforeAll(() => {
  setPtyJobPersistenceEnabled(false);
});

afterAll(() => {
  setPtyJobPersistenceEnabled(true);
  rmSync(sharedHome, { recursive: true, force: true });
  resetProjects();
  resetPty();
});

function args(input: Partial<ProjectRunArgs>): ProjectRunArgs {
  return ProjectRunArgsSchema.parse(input);
}

function setup() {
  const home = join(sharedHome, "case");
  mkdirSync(home, { recursive: true });

  async function run(input: Partial<ProjectRunArgs>) {
    return projectRunCommand.execute(args(input));
  }

  return { home, run };
}

async function readUntil(logPath: string, token: string): Promise<string> {
  let content = "";
  for (let i = 0; i < 40; i++) {
    try { content = readFileSync(logPath, "utf8"); } catch {}
    if (content.includes(token)) break;
    if (i < 39) await Bun.sleep(5);
  }
  return content;
}

describe("project run (in-process command)", () => {
  it("runs a command in the provided project with multiple words", async () => {
    const h = setup();
    const dir = join(h.home, "workdir");
    mkdirSync(dir);
    const res = await h.run({ project: dir, cmd: "echo hello world" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("hello world");
  });

  it("accepts a trailing command with flags", async () => {
    const h = setup();
    const res = await h.run({ cmd: "ls -la" });
    expect(res.success).toBe(true);
  });

  it("supports an explicit target positional", async () => {
    const h = setup();
    const dir = join(h.home, "workdir2");
    mkdirSync(dir);
    const res = await h.run({ target: dir, cmd: "echo ok" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("ok");
  });

  it("keeps flags after the command as child arguments", async () => {
    const h = setup();
    const res = await h.run({ cmd: "echo --detach" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("--detach");
  });

  it("errors on missing command", async () => {
    const h = setup();
    const res = await h.run({});
    expect(res.success).toBe(false);
    expect(res.message).toContain("Command required");
  });

  it("propagates exit code", async () => {
    const h = setup();
    const res = await h.run({ cmd: "false" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("exit code: 1");
  });

  it("reports missing project", async () => {
    const h = setup();
    const res = await h.run({ project: "/no/such/dir", cmd: "echo hi" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("No project matches");
  });

  it("detaches and returns job metadata", async () => {
    const h = setup();
    const res = await h.run({ detach: true, cmd: "echo hello-detach" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("Started in background");
    expect(res.message).toContain("PID:");
    expect(res.message).toContain("Log:");
    expect(res.message).toContain("jobId:");
  });

  it("detached result exposes cwd/jobId/pid/log/background", async () => {
    const h = setup();
    const res = await h.run({ detach: true, cmd: "echo json-detach" });
    expect(res.success).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.background).toBe(true);
    expect(data.cwd).toBeTruthy();
    expect(data.jobId).toBeTruthy();
    expect(typeof data.pid).toBe("number");
    expect(data.log).toBeTruthy();
    const content = await readUntil(data.log as string, "json-detach");
    expect(content).toContain("json-detach");
  });

  it("foreground result exposes jobId and exit code", async () => {
    const h = setup();
    const res = await h.run({ cmd: "echo fg-jobid" });
    expect(res.success).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.jobId).toBeTruthy();
    expect(data.exitCode).toBe(0);
  });

  it("detach returns immediately for long command", async () => {
    const h = setup();
    const start = Date.now();
    const res = await h.run({ detach: true, cmd: "sleep 2" });
    expect(res.success).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("detaches with a command that starts with a flag-like token", async () => {
    const h = setup();
    const res = await h.run({ detach: true, cmd: "echo detach-sep" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("Started in background");
  });
});
