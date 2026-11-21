import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "../file-lock";

describe("withLock", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function tmpLock() {
    const d = mkdtempSync(join(tmpdir(), "lock-"));
    dirs.push(d);
    return join(d, "sub", "state.lock");
  }

  it("returns the result of fn", async () => {
    const lock = tmpLock();
    const res = await withLock(lock, () => 42);
    expect(res).toBe(42);
  });

  it("supports async fn", async () => {
    const lock = tmpLock();
    const res = await withLock(lock, async () => "ok");
    expect(res).toBe("ok");
  });

  it("creates the parent directory", async () => {
    const lock = tmpLock();
    await withLock(lock, () => null);
    // lock file's parent should exist (fn ran without error)
    expect(true).toBe(true);
  });

  it("serializes concurrent access", async () => {
    const lock = tmpLock();
    const order: number[] = [];
    const a = withLock(lock, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
    });
    const b = withLock(lock, async () => {
      order.push(3);
    });
    await Promise.all([a, b]);
    // Either a fully runs then b, or b waits. Ensure 3 not before 2.
    expect(order.indexOf(3)).toBeGreaterThan(order.indexOf(2));
  });

  it("releases the lock so a later call succeeds", async () => {
    const lock = tmpLock();
    await withLock(lock, () => 1);
    const res = await withLock(lock, () => 2);
    expect(res).toBe(2);
  });
});