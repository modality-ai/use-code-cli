import { afterEach, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/** A CronCreate call and the result that assigns the job id. */
function cronCreateLines(
  toolUseId: string,
  jobId: string,
  input: { cron: string; prompt: string; recurring?: boolean },
  schedule = "Every 5 minutes",
): Record<string, unknown>[] {
  const at = "2026-10-28T00:00:00.000Z";
  return [
    {
      type: "assistant",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "CronCreate", input }],
      },
    },
    {
      type: "user",
      timestamp: at,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content:
              `Scheduled recurring job ${jobId} (${schedule}). Session-only ` +
              "(not written to disk, dies when Claude exits).",
          },
        ],
      },
    },
  ];
}

/** A CronDelete call and the result confirming it cancelled the job. */
function cronDeleteLines(toolUseId: string, jobId: string): Record<string, unknown>[] {
  return [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "CronDelete", input: { id: jobId } }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `Cancelled job ${jobId}.`,
          },
        ],
      },
    },
  ];
}

/** A Monitor call and the result that assigns the background task id. */
function monitorStartLines(
  toolUseId: string,
  taskId: string,
  input: { description?: string; timeout_ms?: number } = {},
): Record<string, unknown>[] {
  const at = "2026-10-28T12:00:00.000Z";
  return [
    {
      type: "assistant",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "Monitor", input }],
      },
    },
    {
      type: "user",
      timestamp: at,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content:
              `Monitor started (task ${taskId}). It stays alive until its source ` +
              "ends or it times out.",
          },
        ],
      },
    },
  ];
}

/** A TaskStop call and the result confirming it cancelled the monitor. */
function monitorStopLines(toolUseId: string, taskId: string): Record<string, unknown>[] {
  return [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "TaskStop", input: { taskId } }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `Successfully stopped task: ${taskId}.`,
          },
        ],
      },
    },
  ];
}

/** A TaskStop call whose target already ended on its own. */
function monitorMissingLines(toolUseId: string, taskId: string): Record<string, unknown>[] {
  return [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "TaskStop", input: { taskId } }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `No task found with ID: ${taskId}.`,
          },
        ],
      },
    },
  ];
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
    expect(res.out).toContain('use-code-cli talk use-design-05 "your message"');
    expect(res.out).toContain("💡 Talk to this session:");
    // The success mark the CLI prefixes belongs on the session name, not the tip.
    expect(res.out.split("\n")[0]).toContain("use-design-05");
  });

  it("shows the raw transcript file path", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [deployLine("WANDA")]);
    const expected = join(
      h.home,
      ".claude",
      "projects",
      cwd.replace(/[^a-zA-Z0-9]/g, "-"),
      `${sessionId}.jsonl`,
    );

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toContain(expected);
  });

  it("shows a cross-session message as plain text, without its prefix or envelope", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      deployLine("WANDA"),
      {
        type: "user",
        message: { role: "user", content: "Wanda" },
        turnOrigin: "human",
        promptSource: "typed",
      },
      {
        type: "user",
        message: {
          role: "user",
          content:
            "Another Claude session sent a message:\n" +
            '<cross-session-message from="unknown" from-name="use-design-da">' +
            "check the build</cross-session-message>\n\n" +
            "This came from another Claude session — not typed by your user.",
        },
      },
      { type: "last-prompt", lastPrompt: "Wanda" },
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toContain('"check the build');
    expect(res.out).not.toContain("Another Claude session sent a message");
    expect(res.out).not.toContain("cross-session-message");
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

    const json = await h.run("session", "dead-session", "--json");
    const parsed = JSON.parse(json.out) as { data?: { talk?: unknown } };
    expect(parsed.data?.talk).toBeNull();
  });

  it("reports an unknown target with a hint", async () => {
    const h = setup();

    const res = await h.run("session", "nope");

    expect(res.code).toBe(1);
    expect(res.err).toContain('No session matches "nope"');
  });

  it("lists the cron jobs the session scheduled", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      deployLine("WANDA"),
      ...cronCreateLines("tool-1", "f470b69c", {
        cron: "*/5 * * * *",
        prompt: "check Wanda and Peter status",
      }),
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/cron\s+1 job · session-only/);
    expect(res.out).toContain("f470b69c");
    expect(res.out).toContain('cron="*/5 * * * *"');
    expect(res.out).toContain('schedule="Every 5 minutes"');
    expect(res.out).toContain("check Wanda and Peter status");
  });

  it("drops a cron job once it is cancelled", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      ...cronCreateLines("tool-1", "f470b69c", {
        cron: "*/5 * * * *",
        prompt: "check Wanda and Peter status",
      }),
      ...cronDeleteLines("tool-2", "f470b69c"),
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/cron\s+none/);
    expect(res.out).not.toContain("f470b69c");
  });

  it("--json exposes the cron rows", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      ...cronCreateLines("tool-1", "f470b69c", {
        cron: "*/5 * * * *",
        prompt: "check Wanda and Peter status",
      }),
    ]);

    const res = await h.run("session", "use-design-05", "--json");

    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out) as {
      data?: {
        talk?: { target: string; command: string } | null;
        crons?: {
          id: string;
          cron: string;
          schedule: string | null;
          recurring: boolean;
          prompt: string;
          createdAt: string | null;
        }[];
      };
    };
    expect(parsed.data?.talk).toEqual({
      target: "use-design-05",
      command: 'use-code-cli talk use-design-05 "your message"',
    });
    expect(parsed.data?.crons).toEqual([
      {
        id: "f470b69c",
        cron: "*/5 * * * *",
        schedule: "Every 5 minutes",
        recurring: true,
        prompt: "check Wanda and Peter status",
        createdAt: "2026-10-28T00:00:00.000Z",
      },
    ]);
  });

  it("lists the monitors the session has running", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      deployLine("WANDA"),
      ...monitorStartLines("mon-1", "bc21a9f0", {
        description: "watch for Wanda's reply",
        timeout_ms: 300_000,
      }),
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/monitor\s+1 running · session-only/);
    expect(res.out).toContain("bc21a9f0");
    expect(res.out).toContain("watch for Wanda's reply");
  });

  it("shows monitor none when a session has no monitors", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [deployLine("WANDA")]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/monitor\s+none/);
    expect(res.out).not.toMatch(/monitor\s+1 running/);
  });

  it("drops a monitor once TaskStop cancels it", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      ...monitorStartLines("mon-1", "bc21a9f0", { description: "watch the build" }),
      ...monitorStopLines("mon-2", "bc21a9f0"),
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/monitor\s+none/);
    expect(res.out).not.toContain("bc21a9f0");
  });

  it("drops a monitor whose task is already gone (No task found with ID)", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      ...monitorStartLines("mon-1", "bc21a9f0", { description: "watch the build" }),
      ...monitorMissingLines("mon-2", "bc21a9f0"),
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/monitor\s+none/);
    expect(res.out).not.toContain("bc21a9f0");
  });

  it("ignores a Monitor call whose result never assigned a task", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      {
        type: "assistant",
        timestamp: "2026-10-28T12:00:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "mon-1", name: "Monitor", input: { description: "watch" } },
          ],
        },
      },
    ]);

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/monitor\s+none/);
  });

  it("notes monitors as last known for an offline session", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-stock";
    h.addTranscript(cwd, "dead-session", [
      ...monitorStartLines("mon-1", "e07dc9b2", { description: "poll the deploy" }),
    ]);

    const res = await h.run("session", "dead-session");

    expect(res.code).toBe(0);
    expect(res.out).toContain("last known · session-only monitors ended");
    expect(res.out).toContain("e07dc9b2");
  });

  it("--json exposes the monitor rows", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      ...monitorStartLines("mon-1", "bc21a9f0", {
        description: "watch for Wanda's reply",
        timeout_ms: 300_000,
      }),
    ]);

    const res = await h.run("session", "use-design-05", "--json");

    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out) as { data?: { monitors?: unknown[] } };
    expect(parsed.data?.monitors).toEqual([
      {
        id: "bc21a9f0",
        description: "watch for Wanda's reply",
        timeoutMs: 300_000,
        createdAt: "2026-10-28T12:00:00.000Z",
      },
    ]);
  });

  it("--json nulls out the optional monitor fields it never learned", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "mon-1", name: "Monitor", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "mon-1",
              content: "Monitor started (task bc21a9f0). It stays alive until its source ends.",
            },
          ],
        },
      },
    ]);

    const res = await h.run("session", "use-design-05", "--json");

    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out) as { data?: { monitors?: unknown[] } };
    expect(parsed.data?.monitors).toEqual([
      {
        id: "bc21a9f0",
        description: null,
        timeoutMs: null,
        createdAt: null,
      },
    ]);
  });

  it("skips transcript lines that are not valid JSON", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);
    h.addTranscript(cwd, sessionId, [
      ...monitorStartLines("mon-1", "bc21a9f0", { description: "watch the build" }),
    ]);
    appendFileSync(
      join(h.home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`),
      "\nnot json at all\n",
    );

    const res = await h.run("session", "use-design-05");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/monitor\s+1 running · session-only/);
    expect(res.out).toContain("bc21a9f0");
  });

  it("renames a live session and resolves it by the new name", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-design";
    const sessionId = h.addSession("use-design-05", cwd);

    const res = await h.run("session", "use-design-05", "--rename", "fix-auth");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Renamed session");
    expect(res.out).toContain("fix-auth");
    const names = JSON.parse(
      readFileSync(join(h.home, ".claude", "sessions", "names.json"), "utf8"),
    ) as Record<string, string>;
    expect(names[sessionId]).toBe("fix-auth");

    const after = await h.run("session", "fix-auth");
    expect(after.code).toBe(0);
    expect(after.out).toContain(cwd);
    expect(after.out).toContain("user (--rename)");
  });

  it("refuses to rename a session to a name another session holds", async () => {
    const h = setup();
    h.addSession("use-design-05");
    h.addSession("use-design-06");

    const res = await h.run("session", "use-design-05", "--rename", "use-design-06");

    expect(res.code).toBe(1);
    expect(res.err).toContain("already taken");
  });

  it("renames and resolves an offline session by its sessionId", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-stock";
    const sessionId = h.addTranscript(cwd, "dead-session", [deployLine("PEPPER")]);

    const res = await h.run("session", "dead-session", "--rename", "fix-stock");

    expect(res.code).toBe(0);
    expect(res.out).toContain("fix-stock");

    const after = await h.run("session", "fix-stock");
    expect(after.code).toBe(0);
    expect(after.out).toContain("offline");
    expect(after.out).toContain("PEPPER");
  });

  it("moves an offline session's transcript into a new project directory with --cwd", async () => {
    const h = setup();
    const cwd = "/Volumes/GoldenSnake/git/use-stock";
    const newCwd = "/Volumes/GoldenSnake/git/use-island";
    h.addTranscript(cwd, "dead-session", [deployLine("PEPPER")]);

    const res = await h.run("session", "dead-session", "--cwd", newCwd);

    expect(res.code).toBe(0);
    expect(res.out).toContain("Moved transcript");
    const oldPath = join(h.home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "dead-session.jsonl");
    const newPath = join(h.home, ".claude", "projects", newCwd.replace(/[^a-zA-Z0-9]/g, "-"), "dead-session.jsonl");
    const { existsSync } = await import("node:fs");
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(res.out).toContain(newCwd);
  });

  it("reports no transcript when --cwd targets a session with none", async () => {
    const h = setup();
    const sessionId = h.addSession("use-design-05", "/Volumes/GoldenSnake/git/use-design");

    const res = await h.run("session", "use-design-05", "--cwd", "/Volumes/GoldenSnake/git/use-island");

    // live session has no transcript file in this harness, so nothing to move
    expect(res.code).toBe(0);
    expect(res.out).toContain("No transcript found");
  });
});
