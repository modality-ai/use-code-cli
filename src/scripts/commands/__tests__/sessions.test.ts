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
});
