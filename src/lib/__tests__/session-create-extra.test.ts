import { describe, expect, it } from "bun:test";
import { findExistingSession, sameProject } from "../../lib/session-create";
import { makeSession, PROJECT_CWD, PROJECT_DIR } from "./session-fixture";

describe("sameProject", () => {
  it("matches by cwd equality", () => {
    expect(sameProject(makeSession({ cwd: PROJECT_CWD }), PROJECT_CWD, PROJECT_DIR)).toBe(true);
  });
  it("matches by projectDir equality", () => {
    expect(sameProject(makeSession({ cwd: PROJECT_DIR }), PROJECT_CWD, PROJECT_DIR)).toBe(true);
  });
  it("matches via encodeProjectDir of a candidate", () => {
    const s = makeSession({ cwd: "/tmp/proj" });
    expect(sameProject(s, "/different/cwd", PROJECT_DIR)).toBe(true);
  });
  it("matches via latestCwd", () => {
    const s = makeSession({ cwd: "/other", latestCwd: PROJECT_CWD });
    expect(sameProject(s, PROJECT_CWD, PROJECT_DIR)).toBe(true);
  });
  it("returns false for unrelated project", () => {
    const s = makeSession({ cwd: "/b/proj", latestCwd: "/b/proj" });
    expect(sameProject(s, PROJECT_CWD, PROJECT_DIR)).toBe(false);
  });
  it("skips malformed candidate without throwing", () => {
    const s = makeSession({ cwd: "\x00bad", latestCwd: PROJECT_CWD });
    expect(() => sameProject(s, PROJECT_CWD, PROJECT_DIR)).not.toThrow();
    expect(sameProject(s, PROJECT_CWD, PROJECT_DIR)).toBe(true);
  });
});

describe("findExistingSession extra branches", () => {
  it("duplicate session ids resolve deterministically", async () => {
    const sessions = [
      makeSession({ sessionId: "dup", name: "demo", updatedAt: 10 }),
      makeSession({ sessionId: "dup", name: "demo", updatedAt: 10 }),
    ];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.session?.sessionId).toBe("dup");
  });

  it("empty id falls through to name matching", async () => {
    const sessions = [makeSession({ sessionId: "s1", name: "demo" })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      id: "",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.reason).toBe("name-found");
  });

  it("sameProject latestCwd path through findExistingSession", async () => {
    const sessions = [makeSession({ sessionId: "x", name: "demo", cwd: "/other", latestCwd: PROJECT_CWD })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(true);
  });
});
