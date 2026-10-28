import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "../../../runner/cli.ts");

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** A throwaway HOME holding a fake ~/.claude tree. */
function setup() {
  const home = mkdtempSync(join(tmpdir(), "use-code-cli-"));
  const projectsDir = join(home, ".claude", "projects");
  mkdirSync(projectsDir, { recursive: true });
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));

  /**
   * Add one memory file to a project's memory directory. A transcript is
   * written alongside so the project's workspace path resolves, matching a
   * real project folder.
   */
  function addMemory(
    cwd: string,
    file: string,
    content: string,
    updatedAt = Date.now(),
  ) {
    const dir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const memoryDir = join(projectsDir, dir, "memory");
    const path = join(memoryDir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    utimesSync(path, updatedAt / 1000, updatedAt / 1000);
    writeFileSync(
      join(projectsDir, dir, "session-test.jsonl"),
      JSON.stringify({ cwd, type: "summary" }) + "\n",
    );
  }

  async function run(...args: string[]) {
    const proc = Bun.spawn([process.execPath, CLI, ...args], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, out, err };
  }

  return { addMemory, projectsDir, run };
}

/** A memory file in the frontmatter format Claude Code writes. */
function memoryFile(description: string, body = "body") {
  return `---\nname: example\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${body}\n`;
}

describe("memory", () => {
  it("lists memory files with their description and project", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "feedback-thing.md", memoryFile("Prefer bun over node."));

    const res = await h.run("memory");

    expect(res.code).toBe(0);
    expect(res.out).toContain("memory/feedback-thing.md");
    expect(res.out).toContain("Prefer bun over node.");
    expect(res.out).toContain("/w/alpha");
  });

  it("falls back to the first body line when there is no description", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", "# A plain heading\nsecond line\n");

    const res = await h.run("memory");

    expect(res.code).toBe(0);
    expect(res.out).toContain("A plain heading");
  });

  it("--search matches file content and reports the first line", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", "line one\nline two has Deploy here\nline three\n");

    const res = await h.run("memory", "--search", "deploy");

    expect(res.code).toBe(0);
    expect(res.out).toContain("match: 1 hit · line 2");
    expect(res.out).toContain("line two has Deploy here");
  });

  it("--search is case-insensitive", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", "Deploy the Missile\n");

    const res = await h.run("memory", "--search", "MISSILE");

    expect(res.code).toBe(0);
    expect(res.out).toContain("Deploy the Missile");
  });

  it("accepts the search term as the first positional", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", memoryFile("deploy notes"));

    const res = await h.run("memory", "deploy");

    expect(res.code).toBe(0);
    expect(res.out).toContain("deploy notes");
  });

  it("--search hides files without a match", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "hit.md", "the parser is broken\n");
    h.addMemory("/w/beta", "miss.md", "the launcher is broken\n");

    const res = await h.run("memory", "--search", "parser");

    expect(res.code).toBe(0);
    expect(res.out).toContain("hit.md");
    expect(res.out).not.toContain("miss.md");
  });

  it("reads nested directories inside the memory folder", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "nested/deep.md", memoryFile("nested memory"));

    const res = await h.run("memory", "--search", "nested memory");

    expect(res.code).toBe(0);
    expect(res.out).toContain("memory/nested/deep.md");
  });

  it("ignores files outside the memory folder", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", memoryFile("real memory"));
    const dir = "/w/alpha".replace(/[^a-zA-Z0-9]/g, "-");
    writeFileSync(join(h.projectsDir, dir, "session-outside.md"), "not memory\n");

    const res = await h.run("memory", "--search", "not memory");

    expect(res.code).toBe(0);
    expect(res.out).toContain('No memory files contain "not memory"');
  });

  it("--limit caps the newest files and says how many were hidden", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "one.md", memoryFile("one"), Date.parse("2026-10-20T10:00:00Z"));
    h.addMemory("/w/alpha", "two.md", memoryFile("two"), Date.parse("2026-10-24T10:00:00Z"));
    h.addMemory("/w/alpha", "three.md", memoryFile("three"), Date.parse("2026-10-26T10:00:00Z"));

    const res = await h.run("memory", "--limit", "2");

    expect(res.code).toBe(0);
    expect(res.out).toContain("three.md");
    expect(res.out).toContain("two.md");
    expect(res.out).not.toContain("one.md");
    expect(res.out).toContain("1 older memory file hidden");
  });

  it("reports how many files were searched when nothing matches", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "a.md", "alpha\n");
    h.addMemory("/w/beta", "b.md", "beta\n");

    const res = await h.run("memory", "--search", "zzz-nope");

    expect(res.code).toBe(0);
    expect(res.out).toContain('No memory files contain "zzz-nope"');
    expect(res.out).toContain("searched 2 files");
  });

  it("reports an empty memory tree", async () => {
    const h = setup();

    const res = await h.run("memory");

    expect(res.code).toBe(0);
    expect(res.out).toContain("No memory files found");
  });

  it("rejects a non-positive --limit value", async () => {
    const h = setup();

    const res = await h.run("memory", "--limit", "0");

    expect(res.code).toBe(1);
    expect(res.err).toContain("must be a positive integer");
  });

  it("--json returns the memory rows", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", memoryFile("json memory"));

    const res = await h.run("memory", "--search", "json", "--json");

    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.out) as {
      data?: { file?: string; cwd?: string; matches?: number; path?: string }[];
    };
    const rows = parsed.data ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.file).toBe("note.md");
    expect(rows[0]?.cwd).toBe("/w/alpha");
    expect(rows[0]?.matches).toBe(1);
    expect(rows[0]?.path?.endsWith(join("memory", "note.md"))).toBe(true);
  });
});

describe("memory — files", () => {
  it("lists every file as one path per line, beyond the default limit", async () => {
    const h = setup();
    for (let i = 0; i < 25; i++) {
      h.addMemory(
        "/w/alpha",
        `file-${i}.md`,
        memoryFile(`memory ${i}`),
        Date.parse("2026-10-20T10:00:00Z") + i * 60_000,
      );
    }

    const res = await h.run("memory", "--files");

    expect(res.code).toBe(0);
    const lines = res.out.trimEnd().split("\n");
    expect(lines.length).toBe(25);
    expect(lines.every((line) => line.includes("/memory/file-"))).toBe(true);
    expect(lines.every((line) => line.endsWith(".md"))).toBe(true);
    expect(res.out).not.toContain("hidden");
    expect(res.out).not.toContain("memory 24");
  });

  it("shortens the home prefix to ~", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "note.md", memoryFile("home path"));

    const res = await h.run("memory", "--files");

    expect(res.code).toBe(0);
    expect(res.out).toContain("~/.claude/projects/");
    expect(res.out).toContain("/memory/note.md");
  });

  it("narrows the listing to search matches", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "hit.md", "the parser is broken\n");
    h.addMemory("/w/beta", "miss.md", "the launcher is broken\n");

    const res = await h.run("memory", "--search", "parser", "--files");

    expect(res.code).toBe(0);
    const lines = res.out.trimEnd().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("hit.md");
    expect(res.out).not.toContain("miss.md");
  });

  it("honours an explicit --limit without a hidden notice", async () => {
    const h = setup();
    h.addMemory("/w/alpha", "one.md", memoryFile("one"), Date.parse("2026-10-20T10:00:00Z"));
    h.addMemory("/w/alpha", "two.md", memoryFile("two"), Date.parse("2026-10-26T10:00:00Z"));

    const res = await h.run("memory", "--files", "--limit", "1");

    expect(res.code).toBe(0);
    const lines = res.out.trimEnd().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("two.md");
    expect(res.out).not.toContain("hidden");
  });
});
