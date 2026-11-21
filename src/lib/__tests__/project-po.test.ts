import { describe, expect, it } from "bun:test";
import { defaultProjectPo } from "../project-po";

describe("defaultProjectPo", () => {
  it("uses the last path segment of cwd", () => {
    expect(defaultProjectPo("dir", "/a/b/proj")).toBe("po-proj");
  });

  it("falls back to dirName when cwd has no segments", () => {
    expect(defaultProjectPo("dirName", "/")).toBe("po-dirName");
  });

  it("handles a cwd without trailing slash", () => {
    expect(defaultProjectPo("d", "/x/y")).toBe("po-y");
  });

  it("handles empty cwd", () => {
    expect(defaultProjectPo("fallback", "")).toBe("po-fallback");
  });
});