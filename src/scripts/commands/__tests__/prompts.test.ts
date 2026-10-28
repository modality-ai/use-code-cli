import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      humanLine("first question"),
      assistantLine("assistant answer"),
      toolResultLine("tool output"),
    ]);

    const res = await h.run("prompts");

    expect(res.code).toBe(0);
    expect(res.out).toContain("first question");
    expect(res.out).not.toContain("assistant answer");
    expect(res.out).not.toContain("tool output");
  });

  it("lists the newest prompt first", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      humanLine("older prompt", "2026-10-20T10:00:00.000Z"),
      humanLine("newer prompt", "2026-10-26T10:00:00.000Z"),
    ]);

    const res = await h.run("prompts");

    expect(res.code).toBe(0);
    expect(res.out.indexOf("newer prompt")).toBeLessThan(res.out.indexOf("older prompt"));
  });

  it("--search matches prompts only, not assistant text", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      humanLine("please fix the parser"),
      assistantLine("I fixed the missile launcher"),
    ]);

    const hit = await h.run("prompts", "--search", "parser");
    expect(hit.code).toBe(0);
    expect(hit.out).toContain("please fix the parser");

    const miss = await h.run("prompts", "--search", "missile");
    expect(miss.code).toBe(0);
    expect(miss.out).toContain('No prompts contain "missile"');
  });

  it("--search is case-insensitive", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("Deploy the Missile")]);

    const res = await h.run("prompts", "--search", "MISSILE");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Deploy the Missile");
  });

  it("labels cross-session prompts and strips their envelope", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      peerLine('<cross-session-message from="unknown">check the build</cross-session-message>'),
    ]);

    const res = await h.run("prompts", "--search", "check the build");

    expect(res.code).toBe(0);
    expect(res.out).toContain("[peer]");
    expect(res.out).toContain("check the build");
    expect(res.out).not.toContain("cross-session-message");
    expect(res.out).not.toContain("Another Claude session sent");
  });

  it("--limit caps the list and says how many were hidden", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [
      humanLine("one", "2026-10-24T10:00:00.000Z"),
      humanLine("two", "2026-10-25T10:00:00.000Z"),
      humanLine("three", "2026-10-26T10:00:00.000Z"),
    ]);

    const res = await h.run("prompts", "--limit", "2");

    expect(res.code).toBe(0);
    expect(res.out).toContain("three");
    expect(res.out).toContain("two");
    expect(res.out).not.toContain("one");
    expect(res.out).toContain("1 older prompt hidden");
  });

  it("--filter-name restricts which sessions are read", async () => {
    const h = setup();
    const design = h.addSession("use-design-05", "idle");
    const stock = h.addSession("use-stock-01", "idle");
    h.addTranscript(design.cwd, design.sessionId, [humanLine("design prompt")]);
    h.addTranscript(stock.cwd, stock.sessionId, [humanLine("stock prompt")]);

    const res = await h.run("prompts", "--filter-name", "DESIGN");

    expect(res.code).toBe(0);
    expect(res.out).toContain("design prompt");
    expect(res.out).not.toContain("stock prompt");
  });

  it("searches offline sessions without --all", async () => {
    const h = setup();
    h.addTranscript("/w/dead-end", "dead-session", [humanLine("ancient wisdom here")]);

    const res = await h.run("prompts", "--search", "ancient wisdom");

    expect(res.code).toBe(0);
    expect(res.out).toContain("dead-session");
    expect(res.out).toContain("ancient wisdom here");
  });

  it("reports how many sessions were searched when nothing matches", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("nothing relevant")]);

    const res = await h.run("prompts", "--search", "zzz-nope");

    expect(res.code).toBe(0);
    expect(res.out).toContain('No prompts contain "zzz-nope"');
    expect(res.out).toContain("(searched 1 session)");
  });

  it("rejects a non-positive --limit value", async () => {
    const h = setup();

    const zero = await h.run("prompts", "--limit", "0");
    expect(zero.code).toBe(1);
    expect(zero.err).toContain("must be a positive integer");
  });

  it("--json returns the prompt rows", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("json prompt")]);

    const res = await h.run("prompts", "--search", "json", "--json");

    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out) as { data?: { text?: string; kind?: string }[] };
    const rows = parsed.data ?? [];
    expect(rows.some((r) => r.text === "json prompt" && r.kind === "typed")).toBe(true);
  });

  it("list rows carry the transcript line number", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [assistantLine("noise"), humanLine("second line prompt")]);

    const res = await h.run("prompts", "--search", "second line");

    expect(res.code).toBe(0);
    expect(res.out).toContain("L2");
  });

  it("--show prints one prompt whole, without truncation", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    const long = `keep ${"x".repeat(200)} end`;
    h.addTranscript(cwd, sessionId, [humanLine("short one"), humanLine(long)]);

    const res = await h.run("prompts", "--show", "2");

    expect(res.code).toBe(0);
    expect(res.out.trim()).toBe(long);
    expect(res.out).not.toContain("short one");
  });

  it("--show accepts the L-prefixed reference the list prints", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("first"), humanLine("second")]);

    const res = await h.run("prompts", "--show", "L2");

    expect(res.code).toBe(0);
    expect(res.out.trim()).toBe("second");
  });

  it("--show reports a line holding no prompt", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("only prompt")]);

    const res = await h.run("prompts", "--show", "9");

    expect(res.code).toBe(1);
    expect(res.err).toContain("No prompt at line 9");
  });

  it("rejects a non-numeric --show value", async () => {
    const h = setup();

    const res = await h.run("prompts", "--show", "abc");

    expect(res.code).toBe(1);
    expect(res.err).toContain("must be a prompt line number");
  });
});

describe("prompts — target", () => {
  it("searches only the named session with a second positional", async () => {
    const h = setup();
    const design = h.addSession("use-design-da", "idle");
    const stock = h.addSession("use-stock-01", "idle");
    h.addTranscript(design.cwd, design.sessionId, [humanLine("deploy the design")]);
    h.addTranscript(stock.cwd, stock.sessionId, [humanLine("deploy the stock")]);

    const res = await h.run("prompts", "use-design-da", "deploy");

    expect(res.code).toBe(0);
    expect(res.out).toContain("deploy the design");
    expect(res.out).not.toContain("deploy the stock");
  });

  it("accepts a sessionId target", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-da", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("find me by id")]);

    const res = await h.run("prompts", sessionId, "find me");

    expect(res.code).toBe(0);
    expect(res.out).toContain("find me by id");
  });

  it("lists one session's prompts when no search term is given", async () => {
    const h = setup();
    const design = h.addSession("use-design-da", "idle");
    const stock = h.addSession("use-stock-01", "idle");
    h.addTranscript(design.cwd, design.sessionId, [humanLine("design only")]);
    h.addTranscript(stock.cwd, stock.sessionId, [humanLine("stock only")]);

    const res = await h.run("prompts", "use-design-da");

    expect(res.code).toBe(0);
    expect(res.out).toContain("design only");
    expect(res.out).not.toContain("stock only");
  });

  it("accepts --search with a target", async () => {
    const h = setup();
    const design = h.addSession("use-design-da", "idle");
    const stock = h.addSession("use-stock-01", "idle");
    h.addTranscript(design.cwd, design.sessionId, [humanLine("deploy the design")]);
    h.addTranscript(stock.cwd, stock.sessionId, [humanLine("deploy the stock")]);

    const res = await h.run("prompts", "use-design-da", "--search", "deploy");

    expect(res.code).toBe(0);
    expect(res.out).toContain("deploy the design");
    expect(res.out).not.toContain("deploy the stock");
  });

  it("reports an unknown target and points at --search", async () => {
    const h = setup();

    const res = await h.run("prompts", "nope", "deploy");

    expect(res.code).toBe(1);
    expect(res.err).toContain('No session matches "nope"');
    expect(res.err).toContain("--search");
  });

  it("refuses an ambiguous name prefix and lists candidates", async () => {
    const h = setup();
    h.addSession("use-design-05", "idle");
    h.addSession("use-design-06", "idle");

    const res = await h.run("prompts", "use-design", "deploy");

    expect(res.code).toBe(1);
    expect(res.err).toContain("ambiguous");
    expect(res.err).toContain("use-design-05");
    expect(res.err).toContain("use-design-06");
  });

  it("reports no prompt match within the named session", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-da", "idle");
    h.addTranscript(cwd, sessionId, [humanLine("unrelated")]);

    const res = await h.run("prompts", "use-design-da", "zzz-nope");

    expect(res.code).toBe(0);
    expect(res.out).toContain('No prompts contain "zzz-nope" in use-design-da.');
  });
});
