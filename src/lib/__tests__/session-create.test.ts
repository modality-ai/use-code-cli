import { describe, expect, it } from "bun:test";
import { findExistingSession } from "../session-create";
import { makeSession, PROJECT_CWD, PROJECT_DIR } from "./session-fixture";

describe("findExistingSession", () => {
  it("id match", async () => {
    const sessions = [makeSession({ sessionId: "abc", name: "demo" })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      id: "abc",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.reason).toBe("id-found");
    expect(res.session?.sessionId).toBe("abc");
  });

  it("name match", async () => {
    const sessions = [makeSession({ sessionId: "s1", name: "demo" })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.reason).toBe("name-found");
    expect(res.session?.sessionId).toBe("s1");
  });

  it("offline included", async () => {
    const sessions = [makeSession({ sessionId: "off1", name: "demo", online: false })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.session?.sessionId).toBe("off1");
  });

  it("multiple same-name newest wins", async () => {
    const sessions = [
      makeSession({ sessionId: "old", name: "demo", updatedAt: 5 }),
      makeSession({ sessionId: "new", name: "demo", updatedAt: 10 }),
    ];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.session?.sessionId).toBe("new");
  });

  it("tie-break by sessionId", async () => {
    const sessions = [
      makeSession({ sessionId: "b", name: "demo", updatedAt: 10 }),
      makeSession({ sessionId: "a", name: "demo", updatedAt: 10 }),
    ];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(true);
    expect(res.session?.sessionId).toBe("a");
  });

  it("id-conflict", async () => {
    const sessions = [makeSession({ sessionId: "other", name: "demo" })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      id: "missing",
      sessions,
    });
    expect(res.found).toBe(false);
    expect(res.reason).toBe("id-conflict");
  });

  it("not-found", async () => {
    const sessions = [makeSession({ sessionId: "s1", name: "other" })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(false);
    expect(res.reason).toBe("not-found");
  });

  it("different project same basename is not found", async () => {
    const otherCwd = "/b/proj";
    const sessions = [makeSession({ sessionId: "other", name: "demo", cwd: otherCwd })];
    const res = await findExistingSession({
      projectCwd: PROJECT_CWD,
      projectDir: PROJECT_DIR,
      name: "demo",
      sessions,
    });
    expect(res.found).toBe(false);
    expect(res.reason).toBe("not-found");
  });
});
