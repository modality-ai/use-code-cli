import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { memory, MemoryArgsSchema } from "../../../lib/memory-command";
import type { MemoryArgs } from "../../../lib/memory-command";
import { tmpdir, homedir } from "node:os";
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
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "feedback-thing.md");
    writeFileSync(path, memoryFile("Prefer bun over node."));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "feedback-thing.md", path, updatedAt: Date.now() } as any;
    const result = await memory({} as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("memory/feedback-thing.md");
    expect(result.message).toContain("Prefer bun over node.");
    expect(result.message).toContain("/w/alpha");
  });

  it("falls back to the first body line when there is no description", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "note.md");
    writeFileSync(path, "# A plain heading\nsecond line\n");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = {
      project: "w-alpha",
      cwd: "/w/alpha",
      file: "note.md",
      path,
      updatedAt: Date.now(),
    } as any;
    const result = await memory({} as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("A plain heading");
  });

  it("--search matches file content and reports the first line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "note.md");
    writeFileSync(path, "line one\nline two has Deploy here\nline three\n");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "note.md", path, updatedAt: Date.now() } as any;
    const result = await memory({ search: "deploy" } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("match: 1 hit · line 2");
    expect(result.message).toContain("line two has Deploy here");
  });

  it("--search is case-insensitive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "note.md");
    writeFileSync(path, "Deploy the Missile\n");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "note.md", path, updatedAt: Date.now() } as any;
    const result = await memory({ search: "MISSILE" } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Deploy the Missile");
  });

  it("accepts the search term as the first positional", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "note.md");
    writeFileSync(path, memoryFile("deploy notes"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "note.md", path, updatedAt: Date.now() } as any;
    const result = await memory({ search: "deploy" } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("deploy notes");
  });

  it("--search hides files without a match", async () => {
    const dirHit = mkdtempSync(join(tmpdir(), "mem-"));
    const dirMiss = mkdtempSync(join(tmpdir(), "mem-"));
    const pathHit = join(dirHit, "hit.md");
    const pathMiss = join(dirMiss, "miss.md");
    writeFileSync(pathHit, "the parser is broken\n");
    writeFileSync(pathMiss, "the launcher is broken\n");
    cleanups.push(() => rmSync(dirHit, { recursive: true, force: true }));
    cleanups.push(() => rmSync(dirMiss, { recursive: true, force: true }));
    const hitMem = { project: "w-alpha", cwd: "/w/alpha", file: "hit.md", path: pathHit, updatedAt: Date.now() } as any;
    const missMem = { project: "w-beta", cwd: "/w/beta", file: "miss.md", path: pathMiss, updatedAt: Date.now() } as any;
    const result = await memory({ search: "parser" } as MemoryArgs, { readMemoryFiles: async () => [hitMem, missMem] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("hit.md");
    expect(result.message).not.toContain("miss.md");
  });

  it("reads nested directories inside the memory folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "deep.md");
    writeFileSync(path, memoryFile("nested memory"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "nested/deep.md", path, updatedAt: Date.now() } as any;
    const result = await memory({ search: "nested memory" } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("memory/nested/deep.md");
  });

  it("ignores files outside the memory folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const path = join(dir, "note.md");
    writeFileSync(path, memoryFile("real memory"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = {
      project: "w-alpha",
      cwd: "/w/alpha",
      file: "note.md",
      path,
      updatedAt: Date.now(),
    } as any;
    const result = await memory({ search: "not memory" } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain('No memory files contain "not memory"');
  });

  it("--limit caps the newest files and says how many were hidden", async () => {
    const d1 = mkdtempSync(join(tmpdir(), "mem-"));
    const d2 = mkdtempSync(join(tmpdir(), "mem-"));
    const d3 = mkdtempSync(join(tmpdir(), "mem-"));
    const p1 = join(d1, "one.md");
    const p2 = join(d2, "two.md");
    const p3 = join(d3, "three.md");
    writeFileSync(p1, memoryFile("one"));
    writeFileSync(p2, memoryFile("two"));
    writeFileSync(p3, memoryFile("three"));
    cleanups.push(() => rmSync(d1, { recursive: true, force: true }));
    cleanups.push(() => rmSync(d2, { recursive: true, force: true }));
    cleanups.push(() => rmSync(d3, { recursive: true, force: true }));
    const oneMem = { project: "w-alpha", cwd: "/w/alpha", file: "one.md", path: p1, updatedAt: Date.parse("2026-10-20T10:00:00Z") } as any;
    const twoMem = { project: "w-alpha", cwd: "/w/alpha", file: "two.md", path: p2, updatedAt: Date.parse("2026-10-24T10:00:00Z") } as any;
    const threeMem = { project: "w-alpha", cwd: "/w/alpha", file: "three.md", path: p3, updatedAt: Date.parse("2026-10-26T10:00:00Z") } as any;
    const result = await memory({ limit: "2" } as MemoryArgs, { readMemoryFiles: async () => [threeMem, twoMem, oneMem] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("three.md");
    expect(result.message).toContain("two.md");
    expect(result.message).not.toContain("one.md");
    expect(result.message).toContain("1 older memory file hidden");
  });

  it("reports how many files were searched when nothing matches", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "mem-"));
    const dirB = mkdtempSync(join(tmpdir(), "mem-"));
    const pathA = join(dirA, "a.md");
    const pathB = join(dirB, "b.md");
    writeFileSync(pathA, "alpha\n");
    writeFileSync(pathB, "beta\n");
    cleanups.push(() => rmSync(dirA, { recursive: true, force: true }));
    cleanups.push(() => rmSync(dirB, { recursive: true, force: true }));
    const memA = { project: "w-alpha", cwd: "/w/alpha", file: "a.md", path: pathA, updatedAt: Date.now() } as any;
    const memB = { project: "w-beta", cwd: "/w/beta", file: "b.md", path: pathB, updatedAt: Date.now() } as any;
    const result = await memory({ search: "zzz-nope" } as MemoryArgs, { readMemoryFiles: async () => [memA, memB] });

    expect(result.success).toBe(true);
    expect(result.message).toContain('No memory files contain "zzz-nope"');
    expect(result.message).toContain("searched 2 files");
  });

  it("reports an empty memory tree", async () => {
    const result = await memory({} as MemoryArgs, { readMemoryFiles: async () => [] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("No memory files found");
  });

  it("rejects a non-positive --limit value", () => {
    let thrown: unknown;
    try {
      MemoryArgsSchema.parse({ limit: "0" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(String(thrown)).toContain("must be a positive integer");
  });

  it("--json returns the memory rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const path = join(memoryDir, "note.md");
    writeFileSync(path, memoryFile("json memory"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "note.md", path, updatedAt: Date.now() } as any;
    const result = await memory({ search: "json" } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    const rows = result.data ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.file).toBe("note.md");
    expect(rows[0]?.cwd).toBe("/w/alpha");
    expect(rows[0]?.matches).toBe(1);
    expect(rows[0]?.path?.endsWith(join("memory", "note.md"))).toBe(true);
  });
});

describe("memory — files", () => {
  it("lists every file as one path per line, beyond the default limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const memFiles: any[] = [];
    for (let i = 0; i < 25; i++) {
      const path = join(memoryDir, `file-${i}.md`);
      writeFileSync(path, memoryFile(`memory ${i}`));
      memFiles.push({
        project: "w-alpha",
        cwd: "/w/alpha",
        file: `file-${i}.md`,
        path,
        updatedAt: Date.parse("2026-10-20T10:00:00Z") + i * 60_000,
      });
    }
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const result = await memory({ files: true } as MemoryArgs, { readMemoryFiles: async () => memFiles });

    expect(result.success).toBe(true);
    const lines = result.message.trimEnd().split("\n");
    expect(lines.length).toBe(25);
    expect(lines.every((line) => line.includes("/memory/file-"))).toBe(true);
    expect(lines.every((line) => line.endsWith(".md"))).toBe(true);
    expect(result.message).not.toContain("hidden");
    expect(result.message).not.toContain("memory 24");
  });

  it("shortens the home prefix to ~", async () => {
    const path = join(homedir(), ".claude", "projects", "w-alpha", "memory", "note.md");
    const memFile = { project: "w-alpha", cwd: "/w/alpha", file: "note.md", path, updatedAt: Date.now() } as any;
    const result = await memory({ files: true } as MemoryArgs, { readMemoryFiles: async () => [memFile] });

    expect(result.success).toBe(true);
    expect(result.message).toContain("~/.claude/projects/");
    expect(result.message).toContain("/memory/note.md");
  });

  it("narrows the listing to search matches", async () => {
    const dirHit = mkdtempSync(join(tmpdir(), "mem-"));
    const dirMiss = mkdtempSync(join(tmpdir(), "mem-"));
    const pathHit = join(dirHit, "hit.md");
    const pathMiss = join(dirMiss, "miss.md");
    writeFileSync(pathHit, "the parser is broken\n");
    writeFileSync(pathMiss, "the launcher is broken\n");
    cleanups.push(() => rmSync(dirHit, { recursive: true, force: true }));
    cleanups.push(() => rmSync(dirMiss, { recursive: true, force: true }));
    const hitMem = { project: "w-alpha", cwd: "/w/alpha", file: "hit.md", path: pathHit, updatedAt: Date.now() } as any;
    const missMem = { project: "w-beta", cwd: "/w/beta", file: "miss.md", path: pathMiss, updatedAt: Date.now() } as any;
    const result = await memory({ search: "parser", files: true } as MemoryArgs, { readMemoryFiles: async () => [hitMem, missMem] });

    expect(result.success).toBe(true);
    const lines = result.message.trimEnd().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("hit.md");
    expect(result.message).not.toContain("miss.md");
  });

  it("honours an explicit --limit without a hidden notice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-"));
    const memoryDir = join(dir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const p1 = join(memoryDir, "one.md");
    const p2 = join(memoryDir, "two.md");
    writeFileSync(p1, memoryFile("one"));
    writeFileSync(p2, memoryFile("two"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const oneMem = { project: "w-alpha", cwd: "/w/alpha", file: "one.md", path: p1, updatedAt: Date.parse("2026-10-20T10:00:00Z") } as any;
    const twoMem = { project: "w-alpha", cwd: "/w/alpha", file: "two.md", path: p2, updatedAt: Date.parse("2026-10-26T10:00:00Z") } as any;
    const result = await memory({ files: true, limit: "1" } as MemoryArgs, { readMemoryFiles: async () => [oneMem, twoMem] });

    expect(result.success).toBe(true);
    const lines = result.message.trimEnd().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("one.md");
    expect(result.message).not.toContain("hidden");
  });
});
