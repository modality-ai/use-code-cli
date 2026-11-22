import { describe, expect, it } from "bun:test";
import { resolveServerEntry, resolveServerPath } from "../../../lib/server-entry";

describe("resolveServerPath", () => {
  it("prefers the compiled .js when it exists (dist layout)", () => {
    const exists = (p: string) => p.endsWith("server.js");
    expect(resolveServerPath("/base", exists)).toBe("/base/runner/server.js");
  });

  it("falls back to .ts when no .js exists (dev layout)", () => {
    const exists = () => false;
    expect(resolveServerPath("/base", exists)).toBe("/base/runner/server.ts");
  });

  it("uses existsSync by default", () => {
    const p = resolveServerPath("/nonexistent-base");
    expect(p).toMatch(/server\.(js|ts)$/);
  });
});

describe("resolveServerEntry", () => {
  const sourceUrl = "file:///repo/src/scripts/commands/start.ts";
  const bundledUrl = "file:///repo/dist/runner/cli.js";
  const compiledUrl = "file:///repo/dist/scripts/commands/start.js";

  it("resolves to src/runner from the source layout", () => {
    const exists = (p: string) => p === "/repo/src/runner/server.ts";
    expect(resolveServerEntry(sourceUrl, exists)).toBe("/repo/src/runner/server.ts");
  });

  it("resolves to dist/runner from the bundled CLI layout", () => {
    const exists = (p: string) => p === "/repo/dist/runner/server.js";
    expect(resolveServerEntry(bundledUrl, exists)).toBe("/repo/dist/runner/server.js");
  });

  it("resolves to dist/runner from the compiled command layout", () => {
    const exists = (p: string) => p === "/repo/dist/runner/server.ts";
    expect(resolveServerEntry(compiledUrl, exists)).toBe("/repo/dist/runner/server.ts");
  });

  it("falls back to the source-tree base when no server file exists", () => {
    expect(resolveServerEntry(sourceUrl, () => false)).toBe("/repo/src/runner/server.ts");
  });
});
