import { describe, expect, it } from "bun:test";
import { encodeProjectDir } from "../../../lib/sessions";
import { sessionCreateCommand } from "../session-create";
import type { SessionInfo } from "../../../lib/sessions";

describe("sessionCreate", () => {
  const cwd = process.cwd();
  const projDir = encodeProjectDir(cwd);
  const project = { dir: projDir, cwd, sessions: 0, updatedAt: 0 };
  const depsBase = {
    readProjects: async () => [project],
    readSessions: async () => [] as SessionInfo[],
  };

  it("missing name fails", async () => {
    const res = await sessionCreateCommand.create({})({});
    expect(res.success).toBe(false);
    expect(res.message).toContain("--name");
  });

  it("invalid timeout fails", async () => {
    const res = await sessionCreateCommand.create({})({ name: "demo", timeout: 0 });
    expect(res.success).toBe(false);
    expect(res.message).toContain("timeout");
  });

  it("existing reuse returns created:false", async () => {
    const s = { pid: 42, sessionId: "sid-1", name: "demo", cwd, online: true, status: "idle", updatedAt: 10 } as SessionInfo;
    const res = await sessionCreateCommand.create({ ...depsBase, readSessions: async () => [s] })({ name: "demo" });
    expect(res.success).toBe(true);
    expect(res.data.created).toBe(false);
    expect(res.data.sessionId).toBe("sid-1");
  });

  it("id-conflict error", async () => {
    const s = { pid: 1, sessionId: "other", name: "demo", cwd, online: false, status: "offline", updatedAt: 10 } as SessionInfo;
    const res = await sessionCreateCommand.create({ ...depsBase, readSessions: async () => [s] })({ name: "demo", id: "missing" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("different session id");
  });

  it("successful create with generated id", async () => {
    const verifiedSession = { pid: 7, sessionId: "gen-id", name: "demo", cwd, online: true, status: "idle", updatedAt: 10 } as SessionInfo;
    const res = await sessionCreateCommand.create({
        ...depsBase,
        uuid: () => "gen-id",
        spawnSession: async () => ({ success: true, logPath: "/tmp/log" }),
        waitForSpawnedSession: async () => ({ success: true, session: verifiedSession, logPath: "/tmp/log" }),
      })({ name: "demo" });
    expect(res.success).toBe(true);
    expect(res.data.created).toBe(true);
    expect(res.data.sessionId).toBe("gen-id");
    expect(res.data.logPath).toBe("/tmp/log");
  });

  it("successful create with supplied id", async () => {
    const verifiedSession = { pid: 7, sessionId: "supplied-id", name: "demo", cwd, online: true, status: "idle", updatedAt: 10 } as SessionInfo;
    const res = await sessionCreateCommand.create({
        ...depsBase,
        spawnSession: async () => ({ success: true, logPath: "/tmp/log" }),
        waitForSpawnedSession: async (input) => {
          expect(input.expectedId).toBe("supplied-id");
          return { success: true, session: verifiedSession, logPath: "/tmp/log" };
        },
      })({ name: "demo", id: "supplied-id" });
    expect(res.success).toBe(true);
    expect(res.data.sessionId).toBe("supplied-id");
  });

  it("missing claude failure", async () => {
    const res = await sessionCreateCommand.create({
        ...depsBase,
        spawnSession: async () => ({ success: false, message: "claude binary not found on PATH" }),
      })({ name: "demo" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("claude");
  });

  it("timeout failure", async () => {
    const res = await sessionCreateCommand.create({
        ...depsBase,
        spawnSession: async () => ({ success: true, logPath: "/tmp/log" }),
        waitForSpawnedSession: async () => ({ success: false, message: "Timed out", logPath: "/tmp/log" }),
      })({ name: "demo" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Timed out");
    expect(res.data.logPath).toBe("/tmp/log");
  });

  it("log read failure tolerated", async () => {
    const verifiedSession = { pid: 7, sessionId: "gen-id", name: "demo", cwd, online: true, status: "idle", updatedAt: 10 } as SessionInfo;
    const res = await sessionCreateCommand.create({
        ...depsBase,
        uuid: () => "gen-id",
        spawnSession: async () => ({ success: true, logPath: "/tmp/log" }),
        waitForSpawnedSession: async () => ({ success: true, session: verifiedSession, logPath: "/tmp/log" }),
      })({ name: "demo" });
    expect(res.success).toBe(true);
    expect(res.data.created).toBe(true);
  });
});
