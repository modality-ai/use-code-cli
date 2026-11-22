import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadsDir } from "../../../../../lib/uploads";
import { GET } from "../route";

let originalHome: string | undefined;
let tmpHome: string;
let dir: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "uploads-route-"));
  process.env.HOME = tmpHome;
  dir = uploadsDir();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("GET /my/api/upload-list", () => {
  it("returns empty list when no uploads", async () => {
    const res = await GET(new Request("http://localhost/my/api/upload-list"));
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(d.files).toEqual([]);
  });

  it("lists uploaded files with name,url,mtime", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.png"), "x");
    const res = await GET(new Request("http://localhost/my/api/upload-list"));
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(d.files).toHaveLength(1);
    expect(d.files[0].name).toBe("a.png");
    expect(d.files[0].url).toBe("/my/api/upload-list/a.png");
    expect(typeof d.files[0].mtime).toBe("number");
  });
});
