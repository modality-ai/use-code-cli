import { describe, expect, it } from "bun:test";
import { encodeProjectDir } from "../sessions";
import { waitForSpawnedSession } from "../session-create-verify";
import type { SessionInfo } from "../sessions";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_CWD = "/tmp/proj";
const PROJECT_DIR = encodeProjectDir(PROJECT_CWD);

describe("waitForSpawnedSession", () => {
  it("poll success", async () => {
    const s = { sessionId: UUID, cwd: PROJECT_CWD, updatedAt: 1 } as SessionInfo;
    let calls = 0;
    const res = await waitForSpawnedSession({
      expectedId: UUID,
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      readSessions: async () => {
        calls += 1;
        return calls >= 2 ? [s] : [];
      },
      sleep: async () => {},
      now: (() => {
        let t = 0;
        return () => (t += 10);
      })(),
      timeoutMs: 1000,
    });
    expect(res.success).toBe(true);
    expect(res.session?.sessionId).toBe(UUID);
  });

  it("timeout failure includes logPath", async () => {
    const res = await waitForSpawnedSession({
      expectedId: UUID,
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      readSessions: async () => [],
      sleep: async () => {},
      now: () => 0,
      timeoutMs: 10,
      logPath: "/tmp/log",
    });
    expect(res.success).toBe(false);
    expect(res.logPath).toBe("/tmp/log");
    expect(res.message).toContain("Timed out");
  });

  it("project mismatch ignored", async () => {
    const s = { sessionId: UUID, cwd: "/other/proj", updatedAt: 1 } as SessionInfo;
    const res = await waitForSpawnedSession({
      expectedId: UUID,
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      readSessions: async () => [s],
      sleep: async () => {},
      now: () => 100000,
      timeoutMs: 10,
    });
    expect(res.success).toBe(false);
  });
});
