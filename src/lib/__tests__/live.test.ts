import { describe, expect, it } from "bun:test";
import { cleanSession } from "../live";

describe("cleanSession", () => {
  it("returns the session unchanged when lastPrompt is not a string", () => {
    const s = { name: "x", status: "idle" } as any;
    expect(cleanSession(s)).toBe(s);
  });

  it("returns null/undefined input unchanged", () => {
    expect(cleanSession(null)).toBeNull();
    expect(cleanSession(undefined)).toBeUndefined();
  });

  it("cleans lastPrompt when it is a string", () => {
    const s = { name: "x", lastPrompt: "  hello <!-- use-code-cli:auto-reply hop=1 id=a -->  " } as any;
    const out = cleanSession(s);
    expect(out).not.toBe(s);
    expect(out.lastPrompt).toBe("hello");
    expect(s.lastPrompt).toBe("  hello <!-- use-code-cli:auto-reply hop=1 id=a -->  ");
  });

  it("preserves other fields", () => {
    const s = { name: "n", sessionId: "sid", hero: "JAMES", status: "busy", cwd: "/tmp", lastPrompt: "p" } as any;
    const out = cleanSession(s);
    expect(out.name).toBe("n");
    expect(out.sessionId).toBe("sid");
    expect(out.hero).toBe("JAMES");
    expect(out.status).toBe("busy");
    expect(out.cwd).toBe("/tmp");
  });
});