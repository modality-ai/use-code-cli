import { describe, expect, it } from "bun:test";
import { sessionsCommand } from "../sessions";
import { sessionCommand } from "../session";
import type { SessionsArgs } from "../sessions";

describe("sessions", () => {
  it("lists every active session by default", async () => {
    const s1 = {
      pid: 1,
      sessionId: "s1",
      name: "alpha",
      cwd: "/w/alpha",
      startedAt: Date.now() - 60000,
      updatedAt: Date.now(),
      online: true,
      status: "busy",
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
    const result = await sessionsCommand.create({ readSessions: async () => [s1, s2] })({} as SessionsArgs);

    expect(result.success).toBe(true);
    const names = (result.data ?? []).map((r: any) => r.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });
  it("combines both filters", async () => {
    const both = { pid: 1, sessionId: "s1", name: "alpha-code", cwd: "/repo/code-alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "idle" } as any;
    const nameOnly = { pid: 2, sessionId: "s2", name: "alpha-other", cwd: "/repo/other", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "idle" } as any;
    const projectOnly = { pid: 3, sessionId: "s3", name: "beta-code", cwd: "/repo/code-beta", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "idle" } as any;
    const neither = { pid: 4, sessionId: "s4", name: "gamma-other", cwd: "/repo/other-gamma", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "idle" } as any;
    const result = await sessionsCommand.create({ readSessions: async () => [both, nameOnly, projectOnly, neither] })({ "filter-name": "alpha", "filter-project": "code" } as SessionsArgs);

    expect(result.success).toBe(true);
    const names = (result.data ?? []).map((r: any) => r.name);
    expect(names).toContain("alpha-code");
    expect(names).not.toContain("alpha-other");
    expect(names).not.toContain("beta-code");
    expect(names).not.toContain("gamma-other");
  });
  it("honours explicit --json and --human output flags", async () => {
    const sess = { pid: 1, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "busy" } as any;
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      await sessionsCommand.create({ readSessions: async () => [sess] })({ json: true } as any);
      expect(lines.some((l) => l.includes("state"))).toBe(false);

      lines.length = 0;
      await sessionsCommand.create({ readSessions: async () => [sess] })({ human: true } as any);
      expect(lines.some((l) => l.includes("state"))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });
  it("kills a live session's process", async () => {
    const sess = { pid: 123, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "busy" } as any;
    const result = await sessionCommand.create({ readSessions: async () => [sess], killSession: (pid: number, signal: any) => { if (signal === 0) throw new Error("ESRCH"); } })({ target: "alpha", stop: true } as any);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/killed|terminated/i);
  });
  it("forks the session's transcript and pins the original name", async () => {
    const sess = { pid: 1, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "busy" } as any;
    const result = await sessionCommand.create({
        readSessions: async () => [sess],
        forkSession: async () => ({ newSessionId: "alpha-fork", transcriptPath: "/tmp/t", pinnedName: "alpha" }),
      })({ target: "alpha", duplicate: true } as any);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/alpha-fork|forked/i);
  });

  it("--waiting lists only waiting sessions and flags PTY-backed ones approvable", async () => {
    const waitingPty = { pid: 42001, sessionId: "s1", name: "waiting-pty", cwd: "/w/a", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "permission prompt" } as any;
    const waitingExternal = { pid: 42002, sessionId: "s2", name: "waiting-external", cwd: "/w/b", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "permission prompt" } as any;
    const idle = { pid: 42003, sessionId: "s3", name: "idle", cwd: "/w/c", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "idle" } as any;
    const result = await sessionsCommand.create({
      readSessions: async () => [waitingPty, waitingExternal, idle],
      listJobs: async () => [{ jobId: "pty-1-42001", pid: 42001, live: true, approvable: true }] as any,
    })({ waiting: true, json: true } as SessionsArgs);

    expect(result.success).toBe(true);
    const rows = result.data ?? [];
    expect(rows.map((r: any) => r.name)).toEqual(["waiting-pty", "waiting-external"]);
    expect(rows[0]).toMatchObject({ approvable: true, jobId: "pty-1-42001" });
    expect(rows[1]).toMatchObject({ approvable: false, jobId: null });
  });

  it("emits approvable in --json for every row", async () => {
    const sess = { pid: 42004, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "permission prompt" } as any;
    const result = await sessionsCommand.create({
      readSessions: async () => [sess],
      listJobs: async () => [] as any,
    })({ json: true } as SessionsArgs);

    expect(result.success).toBe(true);
    expect(Object.hasOwn(result.data[0], "approvable")).toBe(true);
    expect(result.data[0].approvable).toBe(false);
  });

  it("does not flag a waiting session whose reason is not a permission prompt", async () => {
    const sess = { pid: 42005, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "user input" } as any;
    const result = await sessionsCommand.create({
      readSessions: async () => [sess],
      listJobs: async () => [{ jobId: "pty-1-42005", pid: 42005, live: true, approvable: true }] as any,
    })({ waiting: true, json: true } as SessionsArgs);

    expect(result.data[0].approvable).toBe(false);
  });

  it("does not flag a live job without a reachable control socket", async () => {
    const sess = { pid: 42008, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "permission prompt" } as any;
    const result = await sessionsCommand.create({
      readSessions: async () => [sess],
      listJobs: async () => [{ jobId: "pty-1-42008", pid: 42008, live: true, approvable: false }] as any,
    })({ waiting: true, json: true } as SessionsArgs);

    expect(result.data[0].approvable).toBe(false);
    expect(result.data[0].jobId).toBeNull();
  });

  it("does not flag a session whose PTY job has exited", async () => {
    const sess = { pid: 42006, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "permission prompt" } as any;
    const result = await sessionsCommand.create({
      readSessions: async () => [sess],
      listJobs: async () => [{ jobId: "pty-1-42006", pid: 42006, live: false, approvable: false }] as any,
    })({ waiting: true, json: true } as SessionsArgs);

    expect(result.data[0].approvable).toBe(false);
  });

  it("shows the jobId and approvable column in --waiting human output", async () => {
    const sess = { pid: 42007, sessionId: "s1", name: "alpha", cwd: "/w/alpha", startedAt: Date.now(), updatedAt: Date.now(), online: true, status: "waiting", waitingFor: "permission prompt" } as any;
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      await sessionsCommand.create({
        readSessions: async () => [sess],
        listJobs: async () => [{ jobId: "pty-1-42007", pid: 42007, live: true, approvable: true }] as any,
      })({ waiting: true, human: true } as SessionsArgs);
    } finally {
      console.log = originalLog;
    }
    const table = lines.join("\n");
    expect(table).toContain("approvable");
    expect(table).toContain("pty-1-42007");
    expect(table).toContain("use-code-cli approve pty-1-42007");
  });
});
