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

  it("reports idle agents to sender and PO with identity, output, and actionable prompts", async () => {
    const delivered: { sessionId: string; message: string }[] = [];
    const sessions = (status: string) => [
      { sessionId: "s1", status, name: "agent-one", cwd: "/x/proj-one" },
      { sessionId: "s2", status, name: "agent-two", cwd: "/x/proj-two" },
    ];
    let baseline = true;
    const deps = {
      aiTool: {
        execute: async (args: { command: string; target?: string }) => {
          if (args.command === "sessions") return { data: sessions(baseline ? "busy" : "idle") };
          if (args.command === "session")
            return { message: args.target === "s1" ? "Work finished." : "" };
          if (args.command === "project") return { data: { po: "po-session" } };
          return {};
        },
      },
      liveSessions: async (): Promise<LiveSession[]> => [
        { pid: 1, sessionId: "sender1", name: "sender", cwd: "/x/proj-one" },
        { pid: 2, sessionId: "po-session", name: "po", cwd: "/x/proj-two" },
      ],
      deliver: async (s: LiveSession, m: string) => {
        delivered.push({ sessionId: s.sessionId, message: m });
        return "ok";
      },
      findRepliesForTarget: async (target: string) =>
        target === "s1"
          ? [{ inReplyTo: "m1", targetSessionId: "s1", senderSessionId: "sender1", msgId: "a", at: 1 }]
          : [],
      removeReply: async () => 1,
    } as SessionStatusDeps;

    await run(deps);
    baseline = false;
    await run(deps);

    expect(
      delivered.map(({ sessionId, message }) => ({
        sessionId,
        name: message.includes(`Agent "${sessionId === "sender1" ? "agent-one" : "agent-two"}"`),
        project: message.includes(sessionId === "sender1" ? "proj-one" : "proj-two"),
        output: message.includes(
          sessionId === "sender1"
            ? "Work finished."
            : "agent-two is idle now (no captured output)."
        ),
        actionable: message.includes(
          sessionId === "sender1"
            ? "take it now via `use-code-cli talk`"
            : "perform it now with `use-code-cli talk`"
        ),
        hasNewlines: message.includes("\n"),
        noEscapeHatch: !message.includes("or report your decision"),
      }))
    ).toEqual([
      {
        sessionId: "sender1",
        name: true,
        project: true,
        output: true,
        actionable: true,
        hasNewlines: true,
        noEscapeHatch: true,
      },
      {
        sessionId: "po-session",
        name: true,
        project: true,
        output: true,
        actionable: true,
        hasNewlines: true,
        noEscapeHatch: true,
      },
    ]);
    const poMsg = delivered.find((d) => d.sessionId === "po-session")?.message ?? "";
    expect(poMsg).toContain('Only say "no follow-up" after verification, with a concrete reason.');
    expect(poMsg).toContain('Do not merely describe intent, say "will dispatch", or reply "received"');
    expect(poMsg).not.toContain("or report your decision");
    const senderMsg = delivered.find((d) => d.sessionId === "sender1")?.message ?? "";
    expect(senderMsg).toContain("report the concrete action taken and its result");
    expect(senderMsg).toContain("Do not just acknowledge or describe intent.");
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
