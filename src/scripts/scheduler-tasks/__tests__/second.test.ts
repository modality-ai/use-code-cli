import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as second from "../second";

const g = globalThis as { __secondIntervals?: unknown[]; __secondStop?: () => void };
const fixtureDir = join(import.meta.dir, "fixture");

let originalHome: string | undefined;
let tmpHome: string;
let lockFile: string;
let extraDirs: string[];

function writeLock(input: { pid: number; instanceId: string; heartbeatAt?: number }): void {
  mkdirSync(join(tmpHome, ".use-code-cli"), { recursive: true });
  writeFileSync(lockFile, JSON.stringify({
    token: `${input.pid}:${input.instanceId}`,
    pid: input.pid,
    instanceId: input.instanceId,
    heartbeatAt: input.heartbeatAt ?? Date.now(),
  }));
}

function readLock(): { token: string; pid: number; instanceId: string; heartbeatAt: number } {
  return JSON.parse(readFileSync(lockFile, "utf8"));
}

function fastModuleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "second-fast-"));
  extraDirs.push(dir);
  writeFileSync(join(dir, "fast.ts"), "export const intervalMs = 5;\nexport async function run() {}\n");
  return dir;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "second-guard-"));
  process.env.HOME = tmpHome;
  lockFile = join(tmpHome, ".use-code-cli", "scheduler-second.lock");
  extraDirs = [];
  second.stopSecondScheduler();
});

afterEach(() => {
  // Stop before restoring HOME so the lock is removed from the fixture dir.
  second.stopSecondScheduler();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of extraDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("second parseSchedule", () => {
  it("validates 5- and 6-field cron expressions", () => {
    const five = second.parseSchedule("* * * * *");
    expect(five?.valid).toBe(true);
    expect(five?.sixStar).toBe(false);
    expect(five?.fields.length).toBe(5);

    const six = second.parseSchedule("* * * * * *");
    expect(six?.valid).toBe(true);
    expect(six?.sixStar).toBe(true);
    expect(six?.fields.length).toBe(6);
  });

  it("rejects non-string and wrong field counts", () => {
    expect(second.parseSchedule(42)).toBeNull();
    expect(second.parseSchedule("* * *").valid).toBe(false);
    expect(second.parseSchedule("* * * * * * *").valid).toBe(false);
  });
});

describe("second scan", () => {
  it("returns loaded modules without mutating global modules", async () => {
    const before = second.modules.length;
    const loaded = await second.scan(fixtureDir);
    expect(Array.isArray(loaded)).toBe(true);
    expect(second.modules.length).toBe(before);
  });
});

describe("second run", () => {
  it("re-runs without accumulating (restartable)", async () => {
    const r1 = await second.run(fixtureDir);
    expect(r1.armed).toBe(true);
    expect(Array.isArray(g.__secondIntervals)).toBe(true);
    expect(g.__secondIntervals?.length).toBe(1);

    const r2 = await second.run(fixtureDir);
    expect(r2.armed).toBe(true);
    expect(g.__secondIntervals?.length).toBe(1);

    second.stopSecondScheduler();
    expect(g.__secondIntervals?.length).toBe(0);
  });
});

describe("second singleton guard", () => {
  it("does not let a second instance arm while a fresh live holder owns the lock", async () => {
    writeLock({ pid: process.pid, instanceId: `other-live-${randomUUID()}` });
    const r = await second.run(fixtureDir);
    expect(r).toEqual({ armed: false, moduleCount: 0, leader: false });
    expect(g.__secondIntervals).toHaveLength(0);
    expect(readLock().instanceId).toContain("other-live-");
  });

  it("stops every interval on the next tick after the lock is stolen", async () => {
    const r = await second.run(fastModuleDir());
    expect(r.armed).toBe(true);
    expect(g.__secondIntervals?.length).toBe(1);

    writeLock({ pid: process.pid, instanceId: `thief-${randomUUID()}` });
    await waitUntil(() => g.__secondIntervals?.length === 0);
    expect(g.__secondIntervals?.length).toBe(0);
  });

  it("reclaims a stale lock whose holder process is dead", async () => {
    writeLock({ pid: 999_999, instanceId: "dead-holder", heartbeatAt: Date.now() - 120_000 });
    const r = await second.run(fixtureDir);
    expect(r.armed).toBe(true);
    expect(readLock().pid).toBe(process.pid);
    expect(readLock().instanceId).not.toBe("dead-holder");
  });

  it("does not treat a recycled pid with a different token as ownership", async () => {
    await second.run(fastModuleDir());
    writeLock({ pid: process.pid, instanceId: `reused-pid-${randomUUID()}` });
    await waitUntil(() => g.__secondIntervals?.length === 0);
    expect(g.__secondIntervals?.length).toBe(0);
    // A later clean stop must not delete the new holder's lock.
    second.stopSecondScheduler();
    expect(readLock().instanceId).toContain("reused-pid-");
  });

  it("refreshes the owner token and lock mtime on each heartbeat", async () => {
    await second.run(fastModuleDir());
    const before = readLock();
    const beforeMtime = statSync(lockFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 30));
    const after = readLock();
    expect(after.token).toBe(before.token);
    expect(after.heartbeatAt).toBeGreaterThanOrEqual(before.heartbeatAt);
    expect(statSync(lockFile).mtimeMs).toBeGreaterThanOrEqual(beforeMtime);
  });

  it("publishes heartbeats without leaving temp lock files", async () => {
    await second.run(fastModuleDir());
    await new Promise((r) => setTimeout(r, 30));
    expect(readLock().token).toMatch(/^\d+:/);
    const temps = readdirSync(join(tmpHome, ".use-code-cli")).filter((f) => f.endsWith(".tmp"));
    expect(temps).toEqual([]);
  });

  it("releases the lock on a clean stop", async () => {
    await second.run(fixtureDir);
    expect(existsSync(lockFile)).toBe(true);
    second.stopSecondScheduler();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("does not release a lock that another instance now owns", async () => {
    await second.run(fixtureDir);
    writeLock({ pid: process.pid, instanceId: "thief" });
    second.stopSecondScheduler();
    expect(readLock().instanceId).toBe("thief");
  });

  it("hot reload stops the previous instance's timers without accumulating", async () => {
    const dir = fastModuleDir();
    await second.run(dir);
    expect(g.__secondIntervals?.length).toBe(1);

    // A re-evaluated module calls the previous instance's global stop hook.
    g.__secondStop?.();
    expect(g.__secondIntervals?.length).toBe(0);

    await second.run(dir);
    expect(g.__secondIntervals?.length).toBe(1);
  });
});
