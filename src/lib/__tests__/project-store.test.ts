import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectConfig, setProjectConfigAsync } from "../project-store";

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

describe("project store config", () => {
  it("getProjectConfig returns {} when missing", () => {
    expect(getProjectConfig("nope")).toEqual({});
  });

  it("setProjectConfigAsync then getProjectConfig round trips", async () => {
    await setProjectConfigAsync("d", { dir: "d", cwd: "/c", po: "po-x", sessions: 2, active: 1 });
    expect(getProjectConfig("d")).toEqual({ dir: "d", cwd: "/c", po: "po-x", sessions: 2, active: 1 });
  });

  it("setProjectConfigAsync overwrites the entry", async () => {
    await setProjectConfigAsync("d", { dir: "d", cwd: "/c", po: "first" });
    await setProjectConfigAsync("d", { dir: "d", cwd: "/c", po: "second" });
    expect(getProjectConfig("d").po).toBe("second");
  });

  it("setProjectConfigAsync preserves fields omitted from a partial config", async () => {
    await setProjectConfigAsync("d", { dir: "d", cwd: "/c", po: "po-x", agentBin: "/bin/claude" });
    await setProjectConfigAsync("d", { po: "po-y" });
    expect(getProjectConfig("d")).toEqual({ dir: "d", cwd: "/c", po: "po-y", agentBin: "/bin/claude" });
  });
});
