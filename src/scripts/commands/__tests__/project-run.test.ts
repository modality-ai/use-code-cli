import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const sessionsDir = join(home, ".claude", "sessions");
  const projectsDir = join(home, ".claude", "projects");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  cleanups.push(() => {
    rmSync(home, { recursive: true, force: true });
  });

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
    const proc = Bun.spawn([process.execPath, CLI, ...args], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
      cwd: home,
    });
    const code = await proc.exited;
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, out, err };
  }

  return { home, projectsDir, addProject, run };
}

describe("project run", () => {
  it("runs a command in the current cwd via nested syntax", async () => {
    const h = setup();
    const res = await h.run("project", "run", "pwd");
    expect(res.code).toBe(0);
    expect(res.out + res.err).toContain(h.home);
  });

  it("preserves project command behavior", async () => {
    const h = setup();
    h.addProject("/w/proj", ["a"]);
    const res = await h.run("project", "/w/proj");
    expect(res.code).toBe(0);
    expect(res.out).toContain("/w/proj");
  });

  it("supports -- separator and multi-arg flags", async () => {
    const h = setup();
    const dir = join(h.home, "workdir");
    mkdirSync(dir);
    const res = await h.run("project", "run", "--project", dir, "--", "echo", "hello", "world");
    expect(res.code).toBe(0);
    expect(res.out).toContain("hello world");
  });

  it("supports --- separator", async () => {
    const h = setup();
    const res = await h.run("project", "run", "---", "ls");
    expect(res.code).toBe(0);
  });

  it("supports --- separator with child flags", async () => {
    const h = setup();
    const res = await h.run("project", "run", "---", "ls", "-la");
    expect(res.code).toBe(0);
  });

  it("supports explicit target positional", async () => {
    const h = setup();
    const dir = join(h.home, "workdir2");
    mkdirSync(dir);
    const res = await h.run("project", "run", dir, "--", "echo", "ok");
    expect(res.code).toBe(0);
    expect(res.out).toContain("ok");
  });

  it("errors on missing command", async () => {
    const h = setup();
    const res = await h.run("project", "run");
    expect(res.code).toBe(1);
    expect(res.err + res.out).toContain("Command required");
  });

  it("propagates exit code", async () => {
    const h = setup();
    const res = await h.run("project", "run", "--", "false");
    expect(res.code).toBe(1);
    expect(res.out + res.err).toContain("exit code: 1");
  });

  it("reports missing project", async () => {
    const h = setup();
    const res = await h.run("project", "run", "--project", "/no/such/dir", "--", "echo", "hi");
    expect(res.code).toBe(1);
    expect(res.err + res.out).toContain("No project matches");
  });

  it("detaches and returns job metadata", async () => {
    const h = setup();
    const res = await h.run("project", "run", "--detach", "--", "echo", "hello-detach");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Started in background");
    expect(res.out).toContain("PID:");
    expect(res.out).toContain("Log:");
    expect(res.out).toContain("jobId:");
  });

  it("detaches with --json exposes cwd/jobId/pid/log/background", async () => {
    const h = setup();
    const res = await h.run("project", "run", "--detach", "--json", "--", "echo", "json-detach");
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out);
    expect(parsed.success).toBe(true);
    expect(parsed.background).toBe(true);
    expect(parsed.data.background).toBe(true);
    expect(parsed.data.cwd).toBeTruthy();
    expect(parsed.data.jobId).toBeTruthy();
    expect(typeof parsed.data.pid).toBe("number");
    expect(parsed.data.log).toBeTruthy();
    let content = "";
    for (let i = 0; i < 50; i++) {
      try { content = readFileSync(parsed.data.log, "utf8"); } catch {}
      if (content.includes("json-detach")) break;
      await Bun.sleep(50);
    }
    expect(content).toContain("json-detach");
  });

  it("foreground --json exposes jobId", async () => {
    const h = setup();
    const res = await h.run("project", "run", "--json", "--", "echo", "fg-jobid");
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out);
    expect(parsed.success).toBe(true);
    expect(parsed.data.jobId).toBeTruthy();
    expect(parsed.data.exitCode).toBe(0);
  });

  it("detach returns immediately for long command", async () => {
    const h = setup();
    const start = Date.now();
    const res = await h.run("project", "run", "--detach", "--", "sleep", "2");
    const elapsed = Date.now() - start;
    expect(res.code).toBe(0);
    expect(elapsed).toBeLessThan(2000);
  });

  it("detaches with --- separator", async () => {
    const h = setup();
    const res = await h.run("project", "run", "--detach", "---", "echo", "detach-sep");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Started in background");
  });

  it("keeps --detach after separator as child arg", async () => {
    const h = setup();
    const res = await h.run("project", "run", "---", "echo", "--detach");
    expect(res.code).toBe(0);
    expect(res.out).toContain("--detach");
  });
});
