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
  function addSession(
    name: string,
    status: string,
    updatedAt = Date.now(),
    cwd = `/w/${name}`,
  ) {
    const proc = Bun.spawn(["sleep", "30"]);
    sleeps.push(proc);
    const sessionId = `session-${proc.pid}`;
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

  /** Write the .jsonl that carries a session's branch, hero, and last prompt. */
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

/** A transcript line deploying a Counter hero — what readTranscriptMeta looks for. */
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

describe("sessions", () => {
  it("lists every active session by default", async () => {
    const h = setup();
    h.addSession("alpha", "busy");
    h.addSession("beta", "idle");

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain("alpha");
    expect(res.out).toContain("beta");
  });

  it("--filter-status keeps only sessions in that status", async () => {
    const h = setup();
    h.addSession("alpha", "busy");
    h.addSession("beta", "idle");

    const busy = await h.run("sessions", "--filter-status", "busy");
    expect(busy.code).toBe(0);
    expect(busy.out).toContain("alpha");
    expect(busy.out).not.toContain("beta");

    const idle = await h.run("sessions", "--filter-status", "idle");
    expect(idle.code).toBe(0);
    expect(idle.out).toContain("beta");
    expect(idle.out).not.toContain("alpha");
  });

  it("--filter-name matches a case-insensitive substring", async () => {
    const h = setup();
    h.addSession("use-design-05", "idle");
    h.addSession("use-stock-01", "idle");

    const res = await h.run("sessions", "--filter-name", "DESIGN");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
    expect(res.out).not.toContain("use-stock-01");
  });

  it("--filter-name accepts a comma-separated list", async () => {
    const h = setup();
    h.addSession("use-design-05", "idle");
    h.addSession("use-stock-01", "idle");
    h.addSession("mcp-qdrant-61", "idle");

    const res = await h.run("sessions", "--filter-name", "design, stock");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
    expect(res.out).toContain("use-stock-01");
    expect(res.out).not.toContain("mcp-qdrant-61");
  });

  it("--filter-status accepts a comma-separated list", async () => {
    const h = setup();
    h.addSession("alpha", "busy");
    h.addSession("beta", "idle");

    const res = await h.run("sessions", "--filter-status", "busy,idle");

    expect(res.code).toBe(0);
    expect(res.out).toContain("alpha");
    expect(res.out).toContain("beta");
  });

  it("--filter-hero keeps only sessions with that hero", async () => {
    const h = setup();
    const design = h.addSession("use-design-05", "idle");
    const stock = h.addSession("use-stock-01", "idle");
    h.addSession("bare", "idle");
    h.addTranscript(design.cwd, design.sessionId, [deployLine("WANDA")]);
    h.addTranscript(stock.cwd, stock.sessionId, [deployLine("PEPPER")]);

    const res = await h.run("sessions", "--filter-hero", "wanda");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
    expect(res.out).not.toContain("use-stock-01");
    expect(res.out).not.toContain("bare");
  });

  it("--filter-hero accepts a comma-separated list", async () => {
    const h = setup();
    const design = h.addSession("use-design-05", "idle");
    const stock = h.addSession("use-stock-01", "idle");
    const island = h.addSession("use-island-ce", "idle");
    h.addTranscript(design.cwd, design.sessionId, [deployLine("WANDA")]);
    h.addTranscript(stock.cwd, stock.sessionId, [deployLine("PEPPER")]);
    h.addTranscript(island.cwd, island.sessionId, [deployLine("JAMES")]);

    const res = await h.run("sessions", "--filter-hero", "WANDA, james");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
    expect(res.out).toContain("use-island-ce");
    expect(res.out).not.toContain("use-stock-01");
  });

  it("--filter-hero narrows before --recent trims the list", async () => {
    const h = setup();
    const now = Date.now();
    // The newer PEPPER session would fill --recent 1 if hero filtered after it.
    const wanda = h.addSession("wanda-old", "idle", now - 60_000);
    const pepper = h.addSession("pepper-new", "idle", now);
    h.addTranscript(wanda.cwd, wanda.sessionId, [deployLine("WANDA")]);
    h.addTranscript(pepper.cwd, pepper.sessionId, [deployLine("PEPPER")]);

    const res = await h.run("sessions", "--filter-hero", "WANDA", "--recent", "1");

    expect(res.code).toBe(0);
    expect(res.out).toContain("wanda-old");
    expect(res.out).not.toContain("pepper-new");
    expect(res.out).not.toContain("older session");
  });

  it("names --filter-hero when nothing matches", async () => {
    const h = setup();
    h.addSession("alpha", "busy");

    const res = await h.run("sessions", "--filter-hero", "WANDA");

    expect(res.code).toBe(0);
    expect(res.out).toContain("No active sessions matching --filter-hero=WANDA");
  });

  it("--filter-folder keeps only sessions in that workspace folder", async () => {
    const h = setup();
    h.addSession("alpha", "idle", Date.now(), "/repo/use-code-cli");
    h.addSession("beta", "idle", Date.now(), "/repo/use-design");

    const res = await h.run("sessions", "--filter-folder", "USE-CODE");

    expect(res.code).toBe(0);
    expect(res.out).toContain("alpha");
    expect(res.out).not.toContain("beta");
  });

  it("--filter-folder matches a keyword against the folder name only", async () => {
    const h = setup();
    h.addSession("organism", "idle", Date.now(), "/repo/react-atomic-organism");
    h.addSession("nested", "idle", Date.now(), "/organism/app");

    const res = await h.run("sessions", "--filter-folder", "organism");

    expect(res.code).toBe(0);
    expect(res.out).toContain("react-atomic-organism");
    // A parent directory in the path is not the session's folder.
    expect(res.out).not.toContain("/organism/app");
  });

  it("--filter-folder accepts a comma-separated list", async () => {
    const h = setup();
    h.addSession("alpha", "idle", Date.now(), "/repo/use-code-cli");
    h.addSession("beta", "idle", Date.now(), "/repo/use-design");
    h.addSession("gamma", "idle", Date.now(), "/repo/use-stock");

    const res = await h.run("sessions", "--filter-folder", "use-code, stock");

    expect(res.code).toBe(0);
    expect(res.out).toContain("alpha");
    expect(res.out).toContain("gamma");
    expect(res.out).not.toContain("beta");
  });

  it("names --filter-folder when nothing matches", async () => {
    const h = setup();
    h.addSession("alpha", "busy", Date.now(), "/repo/use-code-cli");

    const res = await h.run("sessions", "--filter-folder", "nowhere");

    expect(res.code).toBe(0);
    expect(res.out).toContain("No active sessions matching --filter-folder=nowhere");
  });

  it("combines both filters", async () => {
    const h = setup();
    h.addSession("use-design-05", "busy");
    h.addSession("use-design-06", "idle");

    const res = await h.run(
      "sessions",
      "--filter-name",
      "use-design",
      "--filter-status",
      "idle",
    );

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-06");
    expect(res.out).not.toContain("use-design-05  ");
  });

  it("names the active filters when nothing matches", async () => {
    const h = setup();
    h.addSession("alpha", "busy");

    const res = await h.run("sessions", "--filter-status", "idle");

    expect(res.code).toBe(0);
    expect(res.out).toContain("No active sessions matching --filter-status=idle");
  });

  it("rejects an unknown --filter-status value", async () => {
    const h = setup();

    const single = await h.run("sessions", "--filter-status", "sleeping");
    expect(single.code).toBe(1);
    expect(single.err).toContain("filter-status");

    const mixed = await h.run("sessions", "--filter-status", "busy,asleep");
    expect(mixed.code).toBe(1);
    expect(mixed.err).toContain("filter-status");
  });
});

describe("sessions — offline filters", () => {
  it("--filter-name falls back to the workspace folder", async () => {
    const h = setup();
    h.addTranscript("/repo/use-design", "dead-design", [
      { type: "user", message: { content: "finished" } },
    ]);
    h.addTranscript("/repo/use-stock", "dead-stock", [
      { type: "user", message: { content: "finished" } },
    ]);

    const res = await h.run("sessions", "--all", "--filter-name", "use-design");

    expect(res.code).toBe(0);
    expect(res.out).toContain("dead-design");
    expect(res.out).not.toContain("dead-stock");
  });

  it("--filter-folder matches the folder a session cd'd into", async () => {
    const h = setup();
    // The move sits past the head window, so only the transcript tail shows it.
    const filler = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "x".repeat(80 * 1024) }] },
    };
    h.addTranscript("/repo/use-design", "moved-session", [
      { type: "user", message: { content: "start" } },
      filler,
      { type: "user", cwd: "/repo/use-design/app", message: { content: "later" } },
    ]);

    const byEnd = await h.run("sessions", "--all", "--filter-folder", "app");
    expect(byEnd.code).toBe(0);
    expect(byEnd.out).toContain("moved-session");

    // The launch folder still matches too.
    const byStart = await h.run("sessions", "--all", "--filter-folder", "use-design");
    expect(byStart.code).toBe(0);
    expect(byStart.out).toContain("moved-session");
  });
});

describe("sessions — --recent", () => {
  it("--recent N keeps only the newest N sessions", async () => {
    const h = setup();
    const now = Date.now();
    h.addSession("stale", "idle", now - 60_000);
    h.addSession("fresh", "idle", now);

    const res = await h.run("sessions", "--all", "--recent", "1");

    expect(res.code).toBe(0);
    expect(res.out).toContain("fresh");
    expect(res.out).not.toContain("stale");
    expect(res.out).toContain("1 older session hidden");
  });

  it("bare --recent keeps the newest 10", async () => {
    const h = setup();
    const now = Date.now();
    // s01 is the newest; s11 falls past the default window of 10.
    for (let i = 1; i <= 11; i++) {
      const name = `s${String(i).padStart(2, "0")}`;
      h.addSession(name, "idle", now - i * 1_000);
    }

    const res = await h.run("sessions", "--all", "--recent");

    expect(res.code).toBe(0);
    expect(res.out).toContain("s01");
    expect(res.out).toContain("s10");
    expect(res.out).not.toContain("s11");
    expect(res.out).toContain("1 older session hidden");
  });

  it("--recent shows each session's transcript summary", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      deployLine("WANDA"),
      { type: "last-prompt", lastPrompt: "fix the sidebar\nand rerun tests" },
    ]);

    const res = await h.run("sessions", "--recent", "1");

    expect(res.code).toBe(0);
    expect(res.out).toContain("branch=main");
    expect(res.out).toContain("hero=WANDA");
    expect(res.out).toContain('last="fix the sidebar and rerun tests"');
  });

  it("shows more of a long last prompt than the old 80-character clip", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    const prompt =
      "please check the sidebar layout, every responsive breakpoint, and the dark mode contrast before shipping";
    h.addTranscript(cwd, sessionId, [{ type: "last-prompt", lastPrompt: prompt }]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(prompt.length).toBeGreaterThan(80);
    expect(res.out).toContain(`last="${prompt}"`);
  });

  it("shows each session's hero and transcript summary without --recent", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [deployLine("WANDA")]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
    expect(res.out).toContain("hero=WANDA");
    // hero is listed before pid on the head line.
    expect(res.out.indexOf("hero=")).toBeLessThan(res.out.indexOf("pid="));
    expect(res.out).toContain("branch=main");
  });

  it("shows the latest hero even when its Deploy is outside the head and tail windows", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    // Each filler line is ~1.5 MiB, so the SARAH redeploy lands in the middle of
    // a file far larger than the head + tail windows combined.
    const filler = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "x".repeat(1536 * 1024) }] },
    };
    h.addTranscript(cwd, sessionId, [
      deployLine("FRIDAY"),
      filler,
      deployLine("SARAH"),
      filler,
    ]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain("hero=SARAH");
    expect(res.out).not.toContain("hero=FRIDAY");
  });

  it('renders "-" when a session has no hero', async () => {
    const h = setup();
    h.addSession("alpha", "busy");

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain("alpha");
    expect(res.out).toContain("hero=-");
  });

  it("rejects a non-positive --recent value", async () => {
    const h = setup();

    const zero = await h.run("sessions", "--recent", "0");
    expect(zero.code).toBe(1);
    expect(zero.err).toContain("must be a positive integer");

    const text = await h.run("sessions", "--recent", "abc");
    expect(text.code).toBe(1);
    expect(text.err).toContain("must be a positive integer");
  });
});

describe("sessions — last prompt", () => {
  /** A prompt the human typed, as Claude Code records it. */
  function typedLine(text: string) {
    return {
      type: "user",
      message: { role: "user", content: text },
      turnOrigin: "human",
      promptSource: "typed",
    };
  }

  /** A message from another Claude session, recorded as a plain user message. */
  function peerLine(text: string) {
    return {
      type: "user",
      message: {
        role: "user",
        content: `Another Claude session sent a message:\n${text}`,
      },
    };
  }

  it("counts a cross-session message sent after the typed prompt", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    // Claude Code rewrites the last-prompt record with the old value at the end
    // of every turn, so the record sits after the peer message and still says
    // "typed earlier".
    h.addTranscript(cwd, sessionId, [
      typedLine("typed earlier"),
      peerLine("please rerun the tests"),
      { type: "last-prompt", lastPrompt: "typed earlier" },
    ]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain('last="please rerun the tests"');
    expect(res.out).not.toContain("Another Claude session sent a message");
    expect(res.out).not.toContain("typed earlier");
  });

  it("strips Claude Code's cross-session envelope", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      typedLine("typed earlier"),
      {
        type: "user",
        message: {
          role: "user",
          content:
            "Another Claude session sent a message:\n" +
            '<cross-session-message from="unknown" from-name="use-design-da">' +
            "check the build</cross-session-message>",
        },
      },
      { type: "last-prompt", lastPrompt: "typed earlier" },
    ]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain('last="check the build"');
    expect(res.out).not.toContain("cross-session-message");
  });

  it("keeps a typed prompt sent after the cross-session message", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      peerLine("from a peer"),
      typedLine("typed later"),
      { type: "last-prompt", lastPrompt: "typed later" },
    ]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain('last="typed later"');
    expect(res.out).not.toContain("from a peer");
  });

  it("falls back to the record order when the transcript has no turn marker", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      peerLine("from a peer"),
      { type: "last-prompt", lastPrompt: "typed later" },
    ]);

    const res = await h.run("sessions");

    expect(res.code).toBe(0);
    expect(res.out).toContain('last="typed later"');
  });
});

describe("sessions — --search", () => {
  /** A user message line whose text a search can find. */
  function textLine(text: string) {
    return {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    };
  }

  it("finds a phrase in a live session's transcript", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("use-design-05", "idle");
    h.addTranscript(cwd, sessionId, [
      textLine("please deploy the missile before lunch"),
      textLine("unrelated chatter"),
    ]);

    const res = await h.run("sessions", "--search", "missile");

    expect(res.code).toBe(0);
    expect(res.out).toContain("use-design-05");
    expect(res.out).toContain("1 hit");
    expect(res.out).toContain("line 1");
    expect(res.out).toContain("deploy the missile");
  });

  it("searches offline sessions without --all", async () => {
    const h = setup();
    h.addTranscript("/w/dead-end", "dead-session", [textLine("ancient wisdom here")]);

    const res = await h.run("sessions", "--search", "ancient wisdom");

    expect(res.code).toBe(0);
    expect(res.out).toContain("dead-session");
    expect(res.out).toContain("offline");
    expect(res.out).toContain("1 hit");
  });

  it("is case-insensitive and counts every hit", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [textLine("Needle one"), textLine("another needle")]);

    const res = await h.run("sessions", "--search", "NEEDLE");

    expect(res.code).toBe(0);
    expect(res.out).toContain("2 hits");
  });

  it("reports when no transcript contains the term", async () => {
    const h = setup();
    const { sessionId, cwd } = h.addSession("alpha", "idle");
    h.addTranscript(cwd, sessionId, [textLine("nothing relevant")]);

    const res = await h.run("sessions", "--search", "zzz-nope");

    expect(res.code).toBe(0);
    expect(res.out).toContain('No sessions contain "zzz-nope"');
    expect(res.out).toContain("(searched 1)");
  });
});
