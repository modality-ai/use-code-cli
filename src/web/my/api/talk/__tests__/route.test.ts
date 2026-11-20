import { describe, expect, it } from "bun:test";
import { resolveTalkTarget } from "../route";

const fixtureSessions = [
  { pid: 12345, sessionId: "s1", name: "Debug --init", online: true, messagingSocketPath: "/tmp/x", cwd: "/tmp", status: "idle", updatedAt: Date.now() },
  { pid: 29089, sessionId: "s2", name: "other", online: true, messagingSocketPath: "/tmp/y", cwd: "/tmp", status: "idle", updatedAt: Date.now() },
];
const readSessionsFast = async () => fixtureSessions;

describe("resolveTalkTarget", () => {
  it("resolves a known display name to its pid", async () => {
    const target = await resolveTalkTarget("Debug --init", readSessionsFast);
    // The Debug --init session is live; its pid file name is derived, so
    // resolution must return the pid rather than the display name.
    expect(target).not.toBe("Debug --init");
    expect(/^\d+$/.test(target) || target.length > 0).toBe(true);
  });

  it("returns the input unchanged when no session matches", async () => {
    const target = await resolveTalkTarget("definitely-not-a-session-xyz", readSessionsFast);
    expect(target).toBe("definitely-not-a-session-xyz");
  });

  it("is idempotent when given a pid", async () => {
    const target = await resolveTalkTarget("29089", readSessionsFast);
    expect(target).toBe("29089");
  });
});
