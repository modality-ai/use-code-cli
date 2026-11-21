import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { getVapidKeys } from "../vapid";

const tmpHome = mkdtempSync(join(tmpdir(), "vp-"));

beforeEach(() => {
  process.env.HOME = tmpHome;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  try { rmSync(join(tmpHome, ".use-code-cli", "vapid.json"), { force: true }); } catch {}
});

describe("getVapidKeys", () => {
  it("uses env vars when both provided", () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    const k = getVapidKeys();
    expect(k.publicKey).toBe("pub");
    expect(k.privateKey).toBe("priv");
    expect(k.subject).toBe("mailto:hill.tw@gmail.com");
  });

  it("generates and persists when no env/file", () => {
    const k = getVapidKeys();
    expect(k.publicKey).toBeTruthy();
    expect(k.privateKey).toBeTruthy();
    const k2 = getVapidKeys();
    expect(k2.publicKey).toBe(k.publicKey);
  });

  it("reads from persisted file", () => {
    const first = getVapidKeys();
    const second = getVapidKeys();
    expect(second.publicKey).toBe(first.publicKey);
  });
});
