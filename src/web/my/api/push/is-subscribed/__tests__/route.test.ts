import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "../route";
import { addSubscription } from "../../../../../../lib/push-subscriptions";

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "ps-route-"));
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("GET /my/api/push/is-subscribed", () => {
  it("returns 400 when endpoint is missing", async () => {
    const res = await GET(new Request("http://localhost/my/api/push/is-subscribed"));
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.success).toBe(false);
  });

  it("returns subscribed false for an unknown endpoint", async () => {
    const res = await GET(new Request("http://localhost/my/api/push/is-subscribed?endpoint=https%3A%2F%2Fe%2F999"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(d.subscribed).toBe(false);
  });

  it("returns subscribed true for a stored endpoint", async () => {
    await addSubscription({ endpoint: "https://e/1", keys: { p256dh: "p", auth: "a" }, createdAt: 1 });
    const res = await GET(new Request("http://localhost/my/api/push/is-subscribed?endpoint=https%3A%2F%2Fe%2F1"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(d.subscribed).toBe(true);
  });
});
