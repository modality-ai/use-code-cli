import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * A throwaway HOME holding a fake ~/.claude tree. `addSession` registers a live
 * session (pid backed by a `sleep`); `addTranscript` writes the .jsonl that
 * carries branch, hero, and last-prompt metadata.
 */
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

  function addSession(name: string, cwd = home): string {
    const proc = Bun.spawn(["sleep", "30"]);
    sleeps.push(proc);
    const pid = proc.pid;
    const sessionId = `session-${pid}`;
    writeFileSync(
      join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId,
        name,
        cwd,
        status: "idle",
        startedAt: Date.now() - 60_000,
        updatedAt: Date.now(),
      }),
    );
    return sessionId;
  }

  function addTranscript(
    cwd: string,
    sessionId: string,
    lines: Record<string, unknown>[],
  ): void {
    const project = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const dir = join(projectsDir, project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      lines.map((l) => JSON.stringify({ cwd, ...l })).join("\n") + "\n",
    );
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

  return { home, addSession, addTranscript, run };
}

function deployLine(callSign: string) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "mcp__Counter___Counter__Deploy",
          input: { callSign },
        },
      ],
    },
    gitBranch: "main",
  };
}

describe("session", () => {
  it("shows workspace, hero, branch, and how to talk to it", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      deployLine("WANDA"),
      { type: "last-prompt", lastPrompt: "Wanda" },
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toContain("/Volumes/GoldenSnake/git/use-design");
    expect(res.out).toContain("WANDA");
    expect(res.out).toContain("main");
    expect(res.out).toContain('!use-code-cli talk use-design-05 "your message"');
  });

  it("matches a unique name prefix", async () => {
    const h = setup();
    h.addSession("use-design-05");

    const res = await h.run("session", "use-design");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
  });

  it("refuses an ambiguous prefix and lists candidates", async () => {
    const h = setup();
    h.addSession("use-design-05");
    h.addSession("use-design-06");

    const res = await h.run("session", "use-design");

    expect(res.code).toBe(1);
    expect(res.err).toContain("ambiguous");
    expect(res.err).toContain("use-design-05");
    expect(res.err).toContain("use-design-06");
  });

  it("finds an offline session by sessionId", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-stock";
    h.addTranscript(cwd, "dead-session", [deployLine("PEPPER")]);

    const res = await h.run("session", "dead-session");

    expect(res.code).toBe(0);
    expect(res.out).toContain("offline");
    expect(res.out).toContain("PEPPER");
    expect(res.out).toContain("start it in /Volumes/GoldenSnake/git/use-stock");
  });

  it("reports an unknown target with a hint", async () => {
    const h = setup();

    const res = await h.run("session", "nope");

    expect(res.code).toBe(1);
    expect(res.err).toContain('No session matches "nope"');
  });
});
