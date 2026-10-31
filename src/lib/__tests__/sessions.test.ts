import { describe, expect, it } from "bun:test";
import { applySessionNames } from "../sessions";

describe("applySessionNames", () => {
  it("pins the custom name and marks nameSource=user when a registry entry exists", () => {
    const sessions = [{ sessionId: "s1", name: "derived", nameSource: undefined as string | undefined }];
    const names = { s1: "pinned-name" };
    const out = applySessionNames(sessions, names);
    expect(out).toBe(sessions);
    expect(sessions[0]!.name).toBe("pinned-name");
    expect(sessions[0]!.nameSource).toBe("user");
  });

  it("leaves sessions without a registry entry untouched (name and nameSource)", () => {
    const sessions = [{ sessionId: "s2", name: "derived", nameSource: undefined as string | undefined }];
    const out = applySessionNames(sessions, {});
    expect(out).toBe(sessions);
    expect(sessions[0]!.name).toBe("derived");
    expect(sessions[0]!.nameSource).toBeUndefined();
  });

  it("does not overwrite a session's derived name when registry has a different key", () => {
    const sessions = [{ sessionId: "s3", name: "derived", nameSource: undefined as string | undefined }];
    const names = { other: "pinned" };
    applySessionNames(sessions, names);
    expect(sessions[0]!.name).toBe("derived");
    expect(sessions[0]!.nameSource).toBeUndefined();
  });

  it("applies names across multiple sessions independently", () => {
    const sessions = [
      { sessionId: "a", name: "derived-a", nameSource: undefined as string | undefined },
      { sessionId: "b", name: "derived-b", nameSource: undefined as string | undefined },
    ];
    applySessionNames(sessions, { a: "alpha", b: "beta" });
    expect(sessions[0]!.name).toBe("alpha");
    expect(sessions[0]!.nameSource).toBe("user");
    expect(sessions[1]!.name).toBe("beta");
    expect(sessions[1]!.nameSource).toBe("user");
  });

  it("partially applies when only some sessions are in the registry", () => {
    const sessions = [
      { sessionId: "a", name: "derived-a", nameSource: undefined as string | undefined },
      { sessionId: "b", name: "derived-b", nameSource: undefined as string | undefined },
    ];
    applySessionNames(sessions, { a: "alpha" });
    expect(sessions[0]!.name).toBe("alpha");
    expect(sessions[0]!.nameSource).toBe("user");
    expect(sessions[1]!.name).toBe("derived-b");
    expect(sessions[1]!.nameSource).toBeUndefined();
  });

  it("overwrites an already user-set nameSource when registry provides a new name", () => {
    const sessions = [{ sessionId: "s", name: "old", nameSource: "user" as string | undefined }];
    applySessionNames(sessions, { s: "new" });
    expect(sessions[0]!.name).toBe("new");
    expect(sessions[0]!.nameSource).toBe("user");
  });

});