import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

const tmpHome = mkdtempSync(join(tmpdir(), "ss-"));
process.env.HOME = tmpHome;

import { resetSessionStatusState, run } from "../session-status";
import type { SessionStatusDeps } from "../session-status";
import type { LiveSession } from "../../../lib/peer";

beforeEach(() => {
  process.env.HOME = tmpHome;
  resetSessionStatusState();
  try { rmSync(join(tmpHome, ".use-code-cli", "last-statuses.json"), { force: true }); } catch {}
});

describe("session-status run", () => {
  it("baselines on first run without alerts", async () => {
    const delivered: string[] = [];
    const aiTool = { execute: async () => ({ data: [{ sessionId: "s1", status: "busy", name: "agent", cwd: "/x/proj" }] }) };
    const liveSessions = async () => [];
    const deliver = async (_s: LiveSession, m: string) => { delivered.push(m); return "ok"; };
    const findRepliesForTarget = async () => [];
    const removeReply = async () => 0;
    await run({ aiTool, liveSessions, deliver, findRepliesForTarget, removeReply } as SessionStatusDeps);
    expect(delivered).toHaveLength(0);
  });

  it("does not redeliver when another process updated shared state", async () => {
    const delivered: string[] = [];
    const sessions1 = [{ sessionId: "s1", status: "busy", name: "agent", cwd: "/x/proj" }];
    const sessions2 = [{ sessionId: "s1", status: "idle", name: "agent", cwd: "/x/proj" }];
    let call = 0;
    const aiTool = { execute: async () => ({ data: call++ === 0 ? sessions1 : sessions2 }) };
    const sender: LiveSession = { pid: 1, sessionId: "sender1", name: "sender", cwd: "/x/proj" };
    const liveSessions = async () => [sender];
    const deliver = async (s: LiveSession, m: string) => { delivered.push(`${s.sessionId}:${m}`); return "ok"; };
    const findRepliesForTarget = async () => [{ inReplyTo: "m1", targetSessionId: "s1", senderSessionId: "sender1", msgId: "a", at: 1 }];
    const removeReply = async () => 1;
    await run({ aiTool, liveSessions, deliver, findRepliesForTarget, removeReply } as SessionStatusDeps);
    const dir = join(tmpHome, ".use-code-cli");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "last-statuses.json"), JSON.stringify({ s1: "idle" }));
    await run({ aiTool, liveSessions, deliver, findRepliesForTarget, removeReply } as SessionStatusDeps);
    expect(delivered).toHaveLength(0);
  });

  it("delivers to sender on busy->idle when reply exists", async () => {
    const delivered: string[] = [];
    const sessions1 = [{ sessionId: "s1", status: "busy", name: "agent", cwd: "/x/proj" }];
    const sessions2 = [{ sessionId: "s1", status: "idle", name: "agent", cwd: "/x/proj" }];
    let call = 0;
    const aiTool = { execute: async () => ({ data: call++ === 0 ? sessions1 : sessions2 }) };
    const sender: LiveSession = { pid: 1, sessionId: "sender1", name: "sender", cwd: "/x/proj" };
    const liveSessions = async () => [sender];
    const deliver = async (s: LiveSession, m: string) => { delivered.push(`${s.sessionId}:${m}`); return "ok"; };
    const findRepliesForTarget = async () => [{ inReplyTo: "m1", targetSessionId: "s1", senderSessionId: "sender1", msgId: "a", at: 1 }];
    const removeReply = async () => 1;
    await run({ aiTool, liveSessions, deliver, findRepliesForTarget, removeReply } as SessionStatusDeps);
    await run({ aiTool, liveSessions, deliver, findRepliesForTarget, removeReply } as SessionStatusDeps);
    expect(delivered.some((d) => d.includes("sender1"))).toBe(true);
  });
});
