import { describe, expect, it } from "bun:test";
import { validateConfig } from "../route";

describe("validateConfig", () => {
  it("rejects non-object body", () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig("x").ok).toBe(false);
    expect(validateConfig([]).ok).toBe(false);
  });

  it("requires po", () => {
    expect(validateConfig({ dir: "d", cwd: "/c" }).error).toBe("po is required");
  });

  it("accepts a valid full config", () => {
    const r = validateConfig({ dir: "d", cwd: "/c", po: "po-x", sessions: 2, active: 1, updatedAt: null, path: "/p", agentBin: "/bin/claude" });
    expect(r.ok).toBe(true);
    expect(r.config).toEqual({ dir: "d", cwd: "/c", po: "po-x", sessions: 2, active: 1, updatedAt: null, path: "/p", agentBin: "/bin/claude" });
  });

  it("rejects wrong types", () => {
    expect(validateConfig({ dir: 1, cwd: "/c", po: "p" }).error).toBe("dir must be a string");
    expect(validateConfig({ dir: "d", cwd: 2, po: "p" }).error).toBe("cwd must be a string");
    expect(validateConfig({ dir: "d", cwd: "/c", po: " " }).error).toBe("po must be a non-empty string");
    expect(validateConfig({ dir: "d", cwd: "/c", po: "p", sessions: "x" }).error).toBe("sessions must be a number");
    expect(validateConfig({ dir: "d", cwd: "/c", po: "p", active: NaN }).error).toBe("active must be a number");
    expect(validateConfig({ dir: "d", cwd: "/c", po: "p", updatedAt: {} }).error).toBe("updatedAt must be string, number, or null");
    expect(validateConfig({ dir: "d", cwd: "/c", po: "p", path: 5 }).error).toBe("path must be a string");
    expect(validateConfig({ dir: "d", cwd: "/c", po: "p", agentBin: 7 }).error).toBe("agentBin must be a string");
  });

  it("accepts partial config with only required fields", () => {
    const r = validateConfig({ po: "p" });
    expect(r.ok).toBe(true);
    expect(r.config).toEqual({ po: "p" });
  });
});
