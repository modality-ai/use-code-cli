import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
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

  const sleeps: Bun.Subprocess[] = [];
  cleanups.push(() => {
    for (const p of sleeps) p.kill();
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