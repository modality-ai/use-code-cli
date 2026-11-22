import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { addSubscription, isSubscribed, listSubscriptions, removeSubscription } from "../push-subscriptions";

const tmpHome = mkdtempSync(join(tmpdir(), "ps-"));

beforeEach(() => {
  process.env.HOME = tmpHome;
  try { rmSync(join(tmpHome, ".use-code-cli", "push-subscriptions.json"), { force: true }); } catch {}
});

describe("push-subscriptions", () => {
  it("lists empty initially", async () => {
    expect(await listSubscriptions()).toEqual([]);
  });

  it("adds and lists a subscription", async () => {
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p", auth: "a" }, createdAt: 1 });
    const list = await listSubscriptions();
    expect(list).toHaveLength(1);
    expect(list[0]!.endpoint).toBe("https://e/1");
  });

  it("dedups by endpoint on add", async () => {
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p", auth: "a" }, createdAt: 1 });
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p2", auth: "a2" }, createdAt: 2 });
    const list = await listSubscriptions();
    expect(list).toHaveLength(1);
    expect(list[0]!.keys.p256dh).toBe("p2");
  });

  it("removes by endpoint", async () => {
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p", auth: "a" }, createdAt: 1 });
    await addSubscription({ endpoint: "https://e/2", keys: { p256dh: "p", auth: "a" }, createdAt: 2 });
    await removeSubscription("https://e/1");
    const list = await listSubscriptions();
    expect(list).toHaveLength(1);
    expect(list[0]!.endpoint).toBe("https://e/2");
  });

  it("isSubscribed returns false for empty endpoint", async () => {
    expect(await isSubscribed("")).toBe(false);
  });

  it("isSubscribed returns true for a stored endpoint", async () => {
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p", auth: "a" }, createdAt: 1 });
    expect(await isSubscribed("https://e/1")).toBe(true);
  });

  it("isSubscribed returns false for an unknown endpoint", async () => {
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p", auth: "a" }, createdAt: 1 });
    expect(await isSubscribed("https://e/999")).toBe(false);
  });
});
