import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isUploaded, uploadsDir } from "../uploads";

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "uploads-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("isUploaded", () => {
  it("returns true for a path under uploads dir", () => {
    const dir = uploadsDir();
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "a.png");
    writeFileSync(p, "x");
    expect(isUploaded(p)).toBe(true);
  });

  it("returns false for a path outside uploads dir", () => {
    expect(isUploaded("/etc/passwd")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isUploaded("")).toBe(false);
  });
});
