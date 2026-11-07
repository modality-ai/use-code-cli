import { describe, expect, it } from "bun:test";
import { applySessionNames, splitFilterTerms, matchesSessionFilter, describeSessionFilter, sessionLabel, findSessions, encodeProjectDir, parseTranscriptSessionName, trimValue, compressTranscript } from "../sessions";

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
describe("splitFilterTerms", () => {
  it("returns empty array for undefined/empty", () => {
    expect(splitFilterTerms(undefined)).toEqual([]);
    expect(splitFilterTerms("")).toEqual([]);
  });
  it("splits, trims, lowercases, drops empties", () => {
    expect(splitFilterTerms(" A, b , ,C ")).toEqual(["a", "b", "c"]);
  });
});

describe("matchesSessionFilter", () => {
  const s = { name: "Foo", status: "busy", hero: "JAMES", cwd: "/x/myproj", latestCwd: "/x/myproj" };
  it("passes when no filters", () => {
    expect(matchesSessionFilter(s, {} as any)).toBe(true);
  });
  it("filters by name substring", () => {
    expect(matchesSessionFilter(s, { filterName: "foo" } as any)).toBe(true);
    expect(matchesSessionFilter(s, { filterName: "bar" } as any)).toBe(false);
  });
  it("filters by status exact (case-insensitive)", () => {
    expect(matchesSessionFilter(s, { filterStatus: "busy" } as any)).toBe(true);
    expect(matchesSessionFilter(s, { filterStatus: "BUSY" } as any)).toBe(true);
    expect(matchesSessionFilter(s, { filterStatus: "idle" } as any)).toBe(false);
  });
  it("filters by hero", () => {
    expect(matchesSessionFilter(s, { filterHero: "james" } as any)).toBe(true);
    expect(matchesSessionFilter(s, { filterHero: "wanda" } as any)).toBe(false);
  });
  it("filters by folder basename", () => {
    expect(matchesSessionFilter(s, { filterProject: "myproj" } as any)).toBe(true);
    expect(matchesSessionFilter(s, { filterProject: "/some/myproj" } as any)).toBe(true);
    expect(matchesSessionFilter(s, { filterProject: "other" } as any)).toBe(false);
  });
});

describe("describeSessionFilter", () => {
  it("empty when no filters", () => {
    expect(describeSessionFilter({} as any)).toBe("");
  });
  it("spells active filters", () => {
    expect(describeSessionFilter({ filterName: "x", filterStatus: "busy" } as any)).toBe(" matching --filter-name=x --filter-status=busy");
  });
});

describe("sessionLabel", () => {
  it("uses name when present else sessionId", () => {
    expect(sessionLabel({ sessionId: "id1" })).toBe("id1");
    expect(sessionLabel({ name: "n", sessionId: "id1" })).toBe("n");
  });
});

describe("findSessions", () => {
  const sessions = [
    { sessionId: "s1", name: "alpha", pid: 10 } as any,
    { sessionId: "s2", name: "beta", pid: 20 } as any,
  ];
  it("matches by name prefix", () => {
    expect(findSessions(sessions, "alp").map((x: any) => x.sessionId)).toEqual(["s1"]);
  });
  it("matches by sessionId", () => {
    expect(findSessions(sessions, "s2").map((x: any) => x.sessionId)).toEqual(["s2"]);
  });
  it("returns empty when no match", () => {
    expect(findSessions(sessions, "zzz")).toEqual([]);
  });
});

describe("encodeProjectDir", () => {
  it("encodes a path", () => {
    const out = encodeProjectDir("/tmp/foo");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("parseTranscriptSessionName", () => {
  it("returns undefined for empty/invalid", () => {
    expect(parseTranscriptSessionName("")).toBeUndefined();
    expect(parseTranscriptSessionName("not json")).toBeUndefined();
  });
  it("prefers custom-title over ai-title", () => {
    const text = [
      JSON.stringify({ type: "ai-title", aiTitle: "auto" }),
      JSON.stringify({ type: "custom-title", customTitle: "manual" }),
    ].join("\n");
    expect(parseTranscriptSessionName(text)).toBe("manual");
  });
  it("uses ai-title when no custom", () => {
    const text = JSON.stringify({ type: "ai-title", aiTitle: "auto" });
    expect(parseTranscriptSessionName(text)).toBe("auto");
  });
  it("agent-name counts as custom", () => {
    const text = [
      JSON.stringify({ type: "ai-title", aiTitle: "auto" }),
      JSON.stringify({ type: "agent-name", agentName: "agent" }),
    ].join("\n");
    expect(parseTranscriptSessionName(text)).toBe("agent");
  });
  it("last custom wins over earlier", () => {
    const text = [
      JSON.stringify({ type: "custom-title", customTitle: "first" }),
      JSON.stringify({ type: "custom-title", customTitle: "second" }),
    ].join("\n");
    expect(parseTranscriptSessionName(text)).toBe("second");
  });
});

describe("trimValue", () => {
  it("leaves short strings", () => {
    expect(trimValue("abc", 10)).toBe("abc");
  });
  it("trims long strings with suffix", () => {
    const out = trimValue("a".repeat(20), 5) as string;
    expect(out.startsWith("aaaaa")).toBe(true);
    expect(out).toContain("[compressed:");
  });
  it("recurses arrays and objects", () => {
    expect(trimValue({ a: "x".repeat(20), b: ["y".repeat(20)] }, 3)).toEqual({
      a: "xxx… [compressed: 17 more chars]",
      b: ["yyy… [compressed: 17 more chars]"],
    });
  });
  it("leaves primitives", () => {
    expect(trimValue(42)).toBe(42);
    expect(trimValue(null)).toBe(null);
  });
});

describe("compressTranscript", () => {
  it("trims bulky payloads in a temp file", async () => {
    const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "ct-"));
    const path = join(dir, "t.jsonl");
    const big = "z".repeat(2000);
    await writeFile(path, JSON.stringify({ type: "tool", content: big }) + "\n", "utf8");
    const r = await compressTranscript(path);
    expect(r.entries).toBe(1);
    expect(r.newBytes).toBeLessThan(r.originalBytes);
    const out = await readFile(path, "utf8");
    expect(out).toContain("[compressed:");
    await rm(dir, { recursive: true });
  });
  it("summary mode replaces file with single compact_boundary entry", async () => {
    const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "ct-"));
    const path = join(dir, "t.jsonl");
    await writeFile(path, JSON.stringify({ type: "x" }) + "\n" + JSON.stringify({ type: "y" }) + "\n", "utf8");
    const r = await compressTranscript(path, "summary text");
    expect(r.entries).toBe(1);
    const out = await readFile(path, "utf8");
    expect(out).toContain("compact_boundary");
    expect(out).toContain("summary text");
    await rm(dir, { recursive: true });
  });
});
