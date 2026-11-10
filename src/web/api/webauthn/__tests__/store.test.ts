import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  base64ToBuf,
  bufToBase64,
  getOrCreateUser,
  loadStore,
  saveStore,
  toUint8Array,
  type WebAuthnStore,
} from "../store";

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe("toUint8Array", () => {
  it("converts Buffer", () => {
    const b = Buffer.from([1, 2, 3]);
    expect(Array.from(toUint8Array(b))).toEqual([1, 2, 3]);
  });
  it("converts base64url string", () => {
    const s = Buffer.from([1, 2, 3]).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(Array.from(toUint8Array(s))).toEqual([1, 2, 3]);
  });
});

describe("bufToBase64/base64ToBuf", () => {
  it("round trips", () => {
    const buf = Buffer.from("hello");
    const b64 = bufToBase64(new Uint8Array(buf));
    expect(base64ToBuf(b64)).toEqual(buf);
  });
});

describe("loadStore/saveStore/getOrCreateUser", () => {
  it("loadStore returns null when missing", async () => {
    expect(await loadStore()).toBeNull();
  });
  it("saveStore then loadStore round trips", async () => {
    const store: WebAuthnStore = { userId: "u", userName: "owner", displayName: "Owner", credentials: [] };
    await saveStore(store);
    const loaded = await loadStore();
    expect(loaded).toEqual(store);
  });
  it("loadStore returns null for invalid shape", async () => {
    mkdirSync(join(home, ".use-code-cli"), { recursive: true });
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(home, ".use-code-cli", "webauthn.json"), JSON.stringify({ foo: 1 }), "utf8");
    expect(await loadStore()).toBeNull();
  });
  it("getOrCreateUser creates then reuses", async () => {
    const a = await getOrCreateUser();
    const b = await getOrCreateUser();
    expect(a.userId).toBe(b.userId);
    expect((await loadStore())?.userId).toBe(a.userId);
  });
});
