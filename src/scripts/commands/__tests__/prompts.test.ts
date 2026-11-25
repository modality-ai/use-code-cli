import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promptsCommand } from "../prompts";
import type { PromptsArgs } from "../prompts";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** A throwaway HOME holding a fake ~/.claude tree. */
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

  /** Register a live session, backed by a `sleep` so it counts as online. */
  function addSession(name: string, status: string, updatedAt = Date.now()) {
    const proc = Bun.spawn(["sleep", "30"]);
    sleeps.push(proc);
    const sessionId = `session-${proc.pid}`;
    const cwd = `/w/${name}`;
    writeFileSync(
      join(sessionsDir, `${proc.pid}.json`),
      JSON.stringify({
        pid: proc.pid,
        sessionId,
        name,
        cwd,
        status,
        startedAt: updatedAt - 60_000,
        updatedAt,
      }),
    );
    return { sessionId, cwd };
  }

  /** Write the .jsonl holding a session's transcript. */
  function addTranscript(cwd: string, sessionId: string, lines: Record<string, unknown>[]): void {
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

  return { addSession, addTranscript, run };
}

/** A prompt the human typed, as Claude Code records it. */
function humanLine(text: string, timestamp = "2026-10-26T10:00:00.000Z") {
  return {
    type: "user",
    message: { role: "user", content: text },
    origin: { kind: "human" },
    promptSource: "typed",
    turnOrigin: "human",
    timestamp,
  };
}

/** A message another Claude session delivered into this session. */
function peerLine(text: string, timestamp = "2026-10-26T10:00:00.000Z") {
  return {
    type: "user",
    message: {
      role: "user",
      content: `Another Claude session sent a message:\n${text}`,
    },
    origin: { kind: "peer" },
    promptSource: "system",
    turnOrigin: "peer",
    timestamp,
  };
}

/** An assistant reply — prompt search must never surface its text. */
function assistantLine(text: string) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

/** A tool result recorded as a user message — prompt search must skip it. */
function toolResultLine(text: string) {
  return {
    type: "user",
    message: { role: "user", content: text },
    toolUseResult: { ok: true },
  };
}

describe("prompts", () => {
  it("lists prompts and ignores assistant replies and tool results", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-05",
      cwd: "/w/use-design-05",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "first question" }],
      })({} as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("first question");
    expect(result.message).not.toContain("assistant answer");
    expect(result.message).not.toContain("tool output");
  });

  it("lists the newest prompt first", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-05",
      cwd: "/w/use-design-05",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [
          { kind: "typed", line: 1, timestamp: Date.parse("2026-10-20T10:00:00.000Z"), text: "older prompt" },
          { kind: "typed", line: 2, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "newer prompt" },
        ],
      })({} as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message.indexOf("newer prompt")).toBeLessThan(result.message.indexOf("older prompt"));
  });

  it("--search matches prompts only, not assistant text", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-05",
      cwd: "/w/use-design-05",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const deps = {
      readSessions: async () => [session],
      readPrompts: async () => [{ kind: "typed" as const, line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "please fix the parser" }],
    };

    const hit = await promptsCommand.create(deps)({ search: "parser" } as PromptsArgs);
    expect(hit.success).toBe(true);
    expect(hit.message).toContain("please fix the parser");

    const miss = await promptsCommand.create(deps)({ search: "missile" } as PromptsArgs);
    expect(miss.success).toBe(true);
    expect(miss.message).toContain('No prompts contain "missile"');
  });

  it("--search is case-insensitive", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "Deploy the Missile" }],
      })({ search: "MISSILE" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Deploy the Missile");
  });

  it("labels cross-session prompts and strips their envelope", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-05",
      cwd: "/w/use-design-05",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "peer", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "check the build" }],
      })({ search: "check the build" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("[peer]");
    expect(result.message).toContain("check the build");
    expect(result.message).not.toContain("cross-session-message");
    expect(result.message).not.toContain("Another Claude session sent");
  });

  it("--limit caps the list and says how many were hidden", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [
          { kind: "typed", line: 1, timestamp: Date.parse("2026-10-24T10:00:00.000Z"), text: "one" },
          { kind: "typed", line: 2, timestamp: Date.parse("2026-10-25T10:00:00.000Z"), text: "two" },
          { kind: "typed", line: 3, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "three" },
        ],
      })({ limit: "2" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("three");
    expect(result.message).toContain("two");
    expect(result.message).not.toContain("one");
    expect(result.message).toContain("1 older prompt hidden");
  });

  it("--filter-name restricts which sessions are read", async () => {
    const designSession = {
      pid: 1,
      sessionId: "design-session",
      name: "use-design-05",
      cwd: "/w/use-design-05",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const stockSession = {
      pid: 2,
      sessionId: "stock-session",
      name: "use-stock-01",
      cwd: "/w/use-stock-01",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [designSession, stockSession],
        readPrompts: async (s: any) => s.name === "use-design-05"
          ? [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "design prompt" }]
          : [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "stock prompt" }],
      })({ "filter-name": "DESIGN" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("design prompt");
    expect(result.message).not.toContain("stock prompt");
  });

  it("searches offline sessions without --all", async () => {
    const offlineSession = {
      pid: 999,
      sessionId: "dead-session",
      name: "dead-session",
      cwd: "/w/dead-end",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: false,
      status: "offline",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [offlineSession],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "ancient wisdom here" }],
      })({ search: "ancient wisdom" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("dead-session");
    expect(result.message).toContain("ancient wisdom here");
  });

  it("reports how many sessions were searched when nothing matches", async () => {
    const s1 = {
      pid: 1,
      sessionId: "s1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const s2 = {
      pid: 2,
      sessionId: "s2",
      name: "beta",
      cwd: "/w/beta",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [s1, s2],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "nothing relevant" }],
      })({ search: "zzz-nope" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain('No prompts contain "zzz-nope"');
    expect(result.message).toContain("(searched 2 sessions)");
  });

  it("rejects a non-positive --limit value", () => {
    let err: any;
    try {
      promptsCommand.inputSchema.parse({ limit: "0" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String(err)).toContain("must be a positive integer");
  });

  it("--json returns the prompt rows", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "json prompt" }],
      })({ search: "json" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.text).toBe("json prompt");
    expect(result.data?.[0]?.kind).toBe("typed");
    expect(result.data?.[0]?.sessionId).toBe(session.sessionId);
  });

  it("list rows carry the transcript line number", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 2, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "second line prompt" }],
      })({ search: "second line" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("L2");
  });

  it("--show prints one prompt whole, without truncation", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 3, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "full prompt text here" }],
      })({ show: "L3" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.result).toContain("full prompt text here");
  });

  it("--show accepts the L-prefixed reference the list prints", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 5, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "referenced prompt" }],
      })({ show: "L5" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.result).toContain("referenced prompt");
  });

  it("--show reports a line holding no prompt", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 3, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "only prompt" }],
      })({ show: "L99" } as PromptsArgs);

    expect(result.success).toBe(false);
    expect(result.message).toContain("No prompt at line 99");
  });

  it("rejects a non-numeric --show value", () => {
    let err: any;
    try {
      promptsCommand.inputSchema.parse({ show: "abc" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String(err)).toContain("must be a prompt line number");
  });
});

describe("prompts — target", () => {
  it("searches only the named session with a second positional", async () => {
    const designSession = {
      pid: 1,
      sessionId: "design-session",
      name: "use-design-da",
      cwd: "/w/use-design-da",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const stockSession = {
      pid: 2,
      sessionId: "stock-session",
      name: "use-stock-01",
      cwd: "/w/use-stock-01",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [designSession, stockSession],
        readPrompts: async (s: any) => s.name === "use-design-da"
          ? [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "deploy the design" }]
          : [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "deploy the stock" }],
      })({ target: "use-design-da", search: "deploy" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("deploy the design");
    expect(result.message).not.toContain("deploy the stock");
  });

  it("accepts a sessionId target", async () => {
    const sessionId = "session-123";
    const session = {
      pid: 123,
      sessionId,
      name: "use-design-da",
      cwd: "/w/use-design-da",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "find me by id" }],
      })({ target: sessionId } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("find me by id");
  });

  it("lists one session's prompts when no search term is given", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-da",
      cwd: "/w/use-design-da",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [
          { kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "design only" },
          { kind: "typed", line: 2, timestamp: Date.parse("2026-10-26T10:00:01.000Z"), text: "second design prompt" },
        ],
      })({ target: "use-design-da" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("design only");
    expect(result.message).toContain("second design prompt");
  });

  it("accepts --search with a target", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-da",
      cwd: "/w/use-design-da",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "targeted search match" }],
      })({ target: "use-design-da", search: "targeted" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain("targeted search match");
  });

  it("reports an unknown target and points at --search", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "alpha prompt" }],
      })({ target: "nope", search: "deploy" } as PromptsArgs);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No session matches "nope"');
    expect(result.message).toContain("--search");
  });

  it("refuses an ambiguous name prefix and lists candidates", async () => {
    const s1 = {
      pid: 1,
      sessionId: "s1",
      name: "use-design-05",
      cwd: "/w/use-design-05",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const s2 = {
      pid: 2,
      sessionId: "s2",
      name: "use-design-06",
      cwd: "/w/use-design-06",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [s1, s2],
        readPrompts: async (s: any) => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: `${s.name} prompt` }],
      })({ target: "use-design", search: "deploy" } as PromptsArgs);

    expect(result.success).toBe(false);
    expect(result.message).toContain("ambiguous");
    expect(result.message).toContain("use-design-05");
    expect(result.message).toContain("use-design-06");
  });

  it("reports no prompt match within the named session", async () => {
    const session = {
      pid: 123,
      sessionId: "session-1",
      name: "use-design-da",
      cwd: "/w/use-design-da",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "idle",
    } as any;
    const result = await promptsCommand.create({
        readSessions: async () => [session],
        readPrompts: async () => [{ kind: "typed", line: 1, timestamp: Date.parse("2026-10-26T10:00:00.000Z"), text: "some other text" }],
      })({ target: "use-design-da", search: "zzz-nope" } as PromptsArgs);

    expect(result.success).toBe(true);
    expect(result.message).toContain('No prompts contain "zzz-nope" in use-design-da.');
  });
});
