import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test";
import * as scripts from "../../../../../scripts/index";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const actual = await import("../../../../../lib/sessions");

const mockedSessions = [
  { name: "alpha", sessionId: "sid-1", online: true, status: "waiting", waitingFor: "permission prompt", stopped: true, updatedAt: 1 },
];

mock.module("../../../../../lib/sessions", () => ({
  ...actual,
  readSessions: async () => mockedSessions,
  findSessionsFuzzy: () => mockedSessions,
}));

const { fetchSessionData, fetchThinking, fetchToolResult } = await import("../session-data");

describe("fetchSessionData", () => {
  it("passes waitingFor through the status-only path", async () => {
    const res = await fetchSessionData("alpha", { includeEntries: false });
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe("waiting");
    expect(res.data?.waitingFor).toBe("permission prompt");
    expect(res.data?.stopped).toBe(true);
  });
});

describe("fetchThinking", () => {
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ft-"));
    tmpFile = join(tmpDir, "t.jsonl");
  });

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
  });

  it("returns no transcript when session has none", async () => {
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: null } } as any);
    const r = await fetchThinking("alpha", 0);
    expect(r.success).toBe(false);
    expect(r.error).toBe("no transcript");
  });

  it("returns session not found when aiTool fails", async () => {
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: false, message: "boom" } as any);
    const r = await fetchThinking("alpha", 0);
    expect(r.success).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("returns entry not found for out-of-range index", async () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
    writeFileSync(tmpFile, line + "\n");
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: tmpFile } } as any);
    const r = await fetchThinking("alpha", 5);
    expect(r.success).toBe(false);
    expect(r.error).toBe("entry not found");
  });

  it("returns thinking for a valid entry", async () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "<think>deep thought" + "</think>answer" }] } });
    writeFileSync(tmpFile, line + "\n");
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: tmpFile } } as any);
    const r = await fetchThinking("alpha", 0);
    expect(r.success).toBe(true);
    expect(r.thinking).toBe("deep thought");
  });

  it("returns cannot read transcript on read failure", async () => {
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: "/no/such/file.jsonl" } } as any);
    const r = await fetchThinking("alpha", 0);
    expect(r.success).toBe(false);
    expect(r.error).toBe("cannot read transcript");
  });
});

describe("fetchToolResult", () => {
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ft-"));
    tmpFile = join(tmpDir, "t.jsonl");
  });

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
  });

  it("returns missing name or toolId when name is empty", async () => {
    const r = await fetchToolResult("", "t1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("missing name or toolId");
  });

  it("returns tool data for a matching tool id", async () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: { cmd: "ls" } }] } });
    writeFileSync(tmpFile, line + "\n");
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: tmpFile } } as any);
    const r = await fetchToolResult("alpha", "t1");
    expect(r.success).toBe(true);
    expect(r.input).toEqual({ cmd: "ls" });
  });

  it("returns tool not found for unknown id", async () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] } });
    writeFileSync(tmpFile, line + "\n");
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: tmpFile } } as any);
    const r = await fetchToolResult("alpha", "nope");
    expect(r.success).toBe(false);
    expect(r.error).toBe("tool not found");
  });

  it("returns cannot read transcript on read failure", async () => {
    spyOn(scripts.aiTool, "execute").mockResolvedValue({ success: true, data: { transcriptPath: "/no/such/file.jsonl" } } as any);
    const r = await fetchToolResult("alpha", "t1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("cannot read transcript");
  });
});
