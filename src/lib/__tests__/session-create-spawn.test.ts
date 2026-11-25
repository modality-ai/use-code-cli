import { describe, expect, it } from "bun:test";
import type { ProjectRunArgs } from "../project-run";
import { buildSpawnCommand, spawnSession } from "../session-create-spawn";

describe("buildSpawnCommand", () => {
  it("builds equivalent command with safe quoting", () => {
    const cmd = buildSpawnCommand({ name: "a'b", id: "id-1", claudeBin: "claude" });
    expect(cmd).toBe("'claude' --bg --name 'a'\\''b' --session-id 'id-1'");
  });

  it("quotes a claude binary path containing spaces", () => {
    const cmd = buildSpawnCommand({ name: "demo", id: "id-1", claudeBin: "/w/my tools/claude" });
    expect(cmd).toBe("'/w/my tools/claude' --bg --name 'demo' --session-id 'id-1'");
  });
});

describe("spawnSession", () => {
  it("missing claude returns failure", async () => {
    const res = await spawnSession({
      projectTarget: "/tmp/proj",
      name: "demo",
      id: "id-1",
      which: () => null,
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain("claude");
  });

  it("maps project-run detach result", async () => {
    const res = await spawnSession({
      projectTarget: "/tmp/proj",
      name: "demo",
      id: "id-1",
      claudeBin: "claude",
      projectRun: async () => ({
        success: true,
        data: { log: "/tmp/log", jobId: "job-1", pid: 123 },
      }),
    });
    expect(res.success).toBe(true);
    expect(res.logPath).toBe("/tmp/log");
    expect(res.jobId).toBe("job-1");
    expect(res.pid).toBe(123);
    expect(res.command).toContain("--bg");
  });

  it("safe quoting in launched command", async () => {
    let seen: ProjectRunArgs;
    await spawnSession({
      projectTarget: "/tmp/proj",
      name: "n a'me",
      id: "id'x",
      claudeBin: "claude",
      projectRun: async (args) => {
        seen = args;
        return { success: true, data: { log: "l", jobId: "j", pid: 1 } };
      },
    });
    expect(seen.cmd).toContain("'n a'\\''me'");
    expect(seen.cmd).toContain("'id'\\''x'");
    expect(seen.detach).toBe(true);
    expect(seen.detachOwner).toBe("cli");
  });
});
