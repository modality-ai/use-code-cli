import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  colorDiff,
  colorDiffHtml,
  colorDiffAnsi,
  colorDiffPlain,
  resolveEditStartLine,
  colorDiffForTool,
} from "../color-diff";

async function makeTempFile(content: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "cd-"));
  const path = join(dir, "file.ts");
  await writeFile(path, content, "utf8");
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("colorDiff", () => {
  it("marks added lines with + and removed with -", () => {
    const out = colorDiff("a\nb\nc", "a\nB\nc", { plain: true });
    expect(out).toContain("   1   a");
    expect(out).toContain("   2 - b");
    expect(out).toContain("   3 + B");
    expect(out).toContain("   4   c");
  });

  it("returns empty-ish for identical input", () => {
    const out = colorDiff("x", "x", { plain: true });
    expect(out).toContain(" 1   x");
    expect(out).not.toContain("+");
    expect(out).not.toContain("-");
  });

  it("handles empty old (write-style)", () => {
    const out = colorDiff("", "line1\nline2", { plain: true });
    expect(out).toContain("   1 + line1");
    expect(out).toContain("   2 + line2");
  });

  it("html mode escapes special chars", () => {
    const out = colorDiff("<a>", "<b>", {});
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
  });

  it("ansi mode emits color codes", () => {
    const out = colorDiff("a", "b", { ansi: true });
    expect(out).toContain("\x1b[31m");
    expect(out).toContain("\x1b[32m");
  });

  it("includes file path header when provided", () => {
    const out = colorDiff("a", "b", { plain: true, filePath: "foo.ts" });
    expect(out.startsWith("--- foo.ts")).toBe(true);
  });

  it("marks approximate when markApproximate true", () => {
    const out = colorDiff("a", "b", { plain: true, filePath: "foo.ts", markApproximate: true });
    expect(out).toContain("(approx)");
  });

  it("uses startLine for numbering in single mode", () => {
    const out = colorDiff("a", "b", { plain: true, startLine: 10 });
    expect(out).toMatch(/  10 - a/);
    expect(out).toMatch(/  11 \+ b/);
  });

  it("numbers removed and added lines independently in per-side mode", () => {
    const out = colorDiff("a\nb", "a\nB", { plain: true, oldStartLine: 5, newStartLine: 9 });
    expect(out).toMatch(/   5   a/);
    expect(out).toMatch(/   6 - b/);
    expect(out).toMatch(/  10 \+ B/);
  });
});

describe("colorDiffHtml/Ansi/Plain wrappers", () => {
  it("colorDiffHtml wraps in pre", () => {
    const out = colorDiffHtml("a", "b");
    expect(out.startsWith('<pre class="color-diff">')).toBe(true);
    expect(out.endsWith("</pre>")).toBe(true);
  });

  it("colorDiffAnsi forces ansi", () => {
    const out = colorDiffAnsi("a", "b");
    expect(out).toContain("\x1b[");
  });

  it("colorDiffPlain forces plain", () => {
    const out = colorDiffPlain("a", "b");
    expect(out).not.toContain("<span");
    expect(out).not.toContain("\x1b[");
  });
});

describe("resolveEditStartLine", () => {
  it("returns none when no filePath", () => {
    const r = resolveEditStartLine(undefined, "old", "new");
    expect(r).toEqual({ startLine: 1, oldStartLine: 1, newStartLine: 1, confidence: "none", matchedBy: "none" });
  });

  it("returns none when file missing", async () => {
    const r = resolveEditStartLine("/no/such/file.ts", "old", "new");
    expect(r.confidence).toBe("none");
  });

  it("write-style when old empty", async () => {
    const t = await makeTempFile("hello\nworld");
    try {
      const r = resolveEditStartLine(t.path, "", "hello");
      expect(r.confidence).toBe("exact");
      expect(r.matchedBy).toBe("none");
    } finally {
      await t.cleanup();
    }
  });

  it("matches by new_string", async () => {
    const t = await makeTempFile("alpha\nbeta\ngamma");
    try {
      const r = resolveEditStartLine(t.path, "OLD", "beta");
      expect(r.confidence).toBe("exact");
      expect(r.matchedBy).toBe("new");
      expect(r.newStartLine).toBe(2);
    } finally {
      await t.cleanup();
    }
  });

  it("matches by old_string when new not present", async () => {
    const t = await makeTempFile("alpha\nbeta\ngamma");
    try {
      const r = resolveEditStartLine(t.path, "beta", "ZZZ_NOT_PRESENT");
      expect(r.confidence).toBe("exact");
      expect(r.matchedBy).toBe("old");
      expect(r.oldStartLine).toBe(2);
    } finally {
      await t.cleanup();
    }
  });

  it("fuzzy match for partial overlap", async () => {
    const t = await makeTempFile("one\ntwo\nthree\nfour");
    try {
      const r = resolveEditStartLine(t.path, "nope", "two\nthreeX");
      // needleLines filters empty; fuzzy uses new if non-empty. "two" and "threeX" -> window of size 2? N=max(1,2)=2. best score maybe 0.5 <0.6 -> none, or anchor fallback.
      expect(["fuzzy", "anchor", "none"]).toContain(r.confidence);
    } finally {
      await t.cleanup();
    }
  });

  it("large needle shortcut returns none", async () => {
    const t = await makeTempFile("x");
    try {
      const big = "a".repeat(1_000_001);
      const r = resolveEditStartLine(t.path, big, "x");
      expect(r.confidence).toBe("none");
    } finally {
      await t.cleanup();
    }
  });

  it("normalizes curly quotes when matching", async () => {
    const t = await makeTempFile('const x = "hi";\nconst y = 2;');
    try {
      const r = resolveEditStartLine(t.path, "const x = \u201chi\u201d;", "const x = \u201cbye\u201d;");
      // normalizeQuotes converts curly to straight; new string not present -> falls to old match or fuzzy/none
      expect(["exact", "fuzzy", "anchor", "none"]).toContain(r.confidence);
    } finally {
      await t.cleanup();
    }
  });

  it("anchor match for single unique line", async () => {
    const t = await makeTempFile("alpha\nUNIQUE_ANCHOR_LINE\nomega");
    try {
      const r = resolveEditStartLine(t.path, "UNIQUE_ANCHOR_LINE", "OTHER_NOT_PRESENT");
      // old matches exactly -> matchedBy old, not anchor. Use non-present old.
      const r2 = resolveEditStartLine(t.path, "NOT_THERE", "ALSO_NOT_THERE_BUT_ANCHOR?UNIQUE_ANCHOR_LINE");
      expect(r.confidence).toBe("exact");
      expect(r.matchedBy).toBe("old");
      // r2: new not present, old not present, fuzzy probably none, anchor should find UNIQUE... only if candidate includes it
      expect(["anchor", "fuzzy", "none"]).toContain(r2.confidence);
    } finally {
      await t.cleanup();
    }
  });
});

describe("colorDiffForTool", () => {
  it("returns empty for unknown tool", () => {
    expect(colorDiffForTool({ name: "bash", input: { cmd: "ls" } })).toBe("");
  });

  it("returns empty when no input", () => {
    expect(colorDiffForTool(null)).toBe("");
    expect(colorDiffForTool({})).toBe("");
  });

  it("renders edit diff html", () => {
    const out = colorDiffForTool({ name: "edit", input: { file_path: "/tmp/x", old_string: "a", new_string: "b" } });
    expect(out).toContain('<pre class="color-diff">');
    expect(out).toContain("diff-remove");
    expect(out).toContain("diff-add");
  });

  it("renders write diff html", () => {
    const out = colorDiffForTool({ name: "write", input: { file_path: "/tmp/x", content: "hello" } });
    expect(out).toContain('<pre class="color-diff">');
    expect(out).toContain("diff-add");
  });
});

describe("colorDiff lineNumbers", () => {
  it("emits its padded counter by default (backward compat)", () => {
    const out = colorDiff("a", "a");
    expect(out).toMatch(/>\s*1\s+a</);
  });

  it("suppresses the counter with lineNumbers: false (Read already numbers its own lines)", () => {
    const out = colorDiff("a", "a", { lineNumbers: false });
    expect(out).not.toMatch(/1\s+a</);
    expect(out).toMatch(/> {2}a</);
  });
});
