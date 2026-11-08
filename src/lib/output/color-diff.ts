/** Shared helpers for rendering colored diffs of Write/Edit tool changes. */

import * as Diff from "diff";
import { readFileSync } from "node:fs";

export interface ColorDiffOptions {
  /** When true, emit ANSI color codes instead of HTML. */
  ansi?: boolean;
  /** When true, emit plain text with +/- markers (no color). */
  plain?: boolean;
  /** Optional file path to display as a header. */
  filePath?: string;
  /** When true, prefix each line with its line number. */
  lineNumbers?: boolean;
  /** Seed for all lines (backward-compat single counter). */
  startLine?: number;
  /** Seed for removed/context lines (old file). Falls back to startLine. */
  oldStartLine?: number;
  /** Seed for added lines (new file). Falls back to startLine. */
  newStartLine?: number;
  /** When true, prefix lines with a confidence marker ("~" for non-exact). */
  markApproximate?: boolean;
}

export interface ResolveLineResult {
  startLine: number;
  oldStartLine: number;
  newStartLine: number;
  confidence: "exact" | "fuzzy" | "anchor" | "none";
  matchedBy: "new" | "old" | "fuzzy" | "anchor" | "none";
}

const MAX_FILE_BYTES = 1 * 1024 * 1024;

function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitLines(value: string): string[] {
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (trimmed === "") return [];
  return trimmed.split("\n");
}

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function lineNumberOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function allOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let pos = 0;
  while (true) {
    const i = haystack.indexOf(needle, pos);
    if (i === -1) break;
    out.push(i);
    pos = i + Math.max(1, needle.length);
  }
  return out;
}

function contextScore(fileLines: string[], centerLine: number, needle: string): number {
  const windowSize = 3;
  const start = Math.max(0, centerLine - 1 - windowSize);
  const end = Math.min(fileLines.length, centerLine - 1 + windowSize + 1);
  const ctx = fileLines.slice(start, end).join("\n");
  return jaccard(tokenize(ctx), tokenize(needle));
}

function bestOccurrenceLine(
  fileNorm: string,
  file: string,
  fileLines: string[],
  needle: string,
  contextNeedle: string,
): number | null {
  const occs = allOccurrences(fileNorm, needle);
  if (occs.length === 0) return null;
  let bestIdx = occs[0]!;
  if (occs.length > 1) {
    let bestScore = -1;
    for (const o of occs) {
      const ln = lineNumberOf(file, o);
      const sc = contextScore(fileLines, ln, contextNeedle);
      if (sc > bestScore) { bestScore = sc; bestIdx = o; }
    }
  }
  return lineNumberOf(file, bestIdx);
}

export function resolveEditStartLine(
  filePath: string | undefined,
  oldText: string,
  newText: string,
): ResolveLineResult {
  const none: ResolveLineResult = { startLine: 1, oldStartLine: 1, newStartLine: 1, confidence: "none", matchedBy: "none" };

  if (!filePath) return none;
  // Guard against null-byte injection and path traversal in tool-supplied paths.
  if (filePath.includes("\0")) return none;
  const segments = filePath.split(/[\\/]/);
  if (segments.includes("..")) return none;

  let raw: string;
  try {
    const buf = readFileSync(filePath);
    if (buf.byteLength > MAX_FILE_BYTES) return none;
    raw = buf.toString("utf-8");
  } catch {
    return none;
  }

  const file = normalizeEol(raw);
  const oldN = normalizeEol(oldText ?? "");
  const newN = normalizeEol(newText ?? "");

  // Large-needle shortcut: skip file archaeology for huge snippets.
  if (oldN.length >= 1_000_000 || newN.length >= 1_000_000) return none;
  const fileNorm = normalizeQuotes(file);
  const oldNorm = normalizeQuotes(oldN);
  const newNorm = normalizeQuotes(newN);
  const fileLines = file.split("\n");

  // Write-style: old empty → whole file
  if (oldN.trim() === "") {
    return { startLine: 1, oldStartLine: 1, newStartLine: 1, confidence: "exact", matchedBy: "none" };
  }

  // S1: new_string
  if (newN.trim() !== "") {
    const ln = bestOccurrenceLine(fileNorm, file, fileLines, newNorm, oldN + "\n" + newN);
    if (ln !== null) {
      return { startLine: ln, oldStartLine: ln, newStartLine: ln, confidence: "exact", matchedBy: "new" };
    }
  }

  // S2: old_string
  if (oldN.trim() !== "") {
    const ln = bestOccurrenceLine(fileNorm, file, fileLines, oldNorm, oldN + "\n" + newN);
    if (ln !== null) {
      return { startLine: ln, oldStartLine: ln, newStartLine: ln, confidence: "exact", matchedBy: "old" };
    }
  }

  // S3: fuzzy window
  const needleLines = (newNorm.trim() !== "" ? newNorm : oldNorm).split("\n").filter((l) => l.trim() !== "");
  const N = Math.max(1, needleLines.length);
  if (fileLines.length >= N) {
    let bestStart = 0;
    let bestScore = 0;
    for (let i = 0; i + N <= fileLines.length; i++) {
      const window = fileLines.slice(i, i + N);
      const windowSet = new Set(window.map((l) => l.trim()).filter(Boolean));
      const needleSet = new Set(needleLines.map((l) => l.trim()));
      // line-match ratio
      let matches = 0;
      for (const l of needleSet) if (windowSet.has(l)) matches++;
      const score = needleSet.size ? matches / needleSet.size : 0;
      if (score > bestScore) { bestScore = score; bestStart = i; }
    }
    if (bestScore >= 0.6) {
      const ln = bestStart + 1;
      return { startLine: ln, oldStartLine: ln, newStartLine: ln, confidence: "fuzzy", matchedBy: "fuzzy" };
    }
  }

  // S4: anchor line
  const candidateLines = [...oldNorm.split("\n"), ...newNorm.split("\n")]
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // pick longest line as anchor
  candidateLines.sort((a, b) => b.length - a.length);
  for (const anchor of candidateLines) {
    const occs: number[] = [];
    fileLines.forEach((l, i) => { if (l.trim() === anchor) occs.push(i); });
    if (occs.length === 1) {
      const ln = occs[0]! + 1;
      return { startLine: ln, oldStartLine: ln, newStartLine: ln, confidence: "anchor", matchedBy: "anchor" };
    }
    if (occs.length > 1) {
      // pick occurrence with best neighbor similarity
      let bestI = occs[0]!;
      let bestSc = -1;
      for (const i of occs) {
        const sc = contextScore(fileLines, i + 1, oldN + "\n" + newN);
        if (sc > bestSc) { bestSc = sc; bestI = i; }
      }
      const ln = bestI + 1;
      return { startLine: ln, oldStartLine: ln, newStartLine: ln, confidence: "anchor", matchedBy: "anchor" };
    }
  }

  return none;
}

export function colorDiff(oldText: string, newText: string, options?: ColorDiffOptions): string {
  const changes = Diff.diffLines(oldText ?? "", newText ?? "");
  const lines: string[] = [];
  const hasPerSide = options?.oldStartLine !== undefined || options?.newStartLine !== undefined;
  const singleMode = !hasPerSide; // backward compat: single counter

  let oldLineNo = options?.oldStartLine ?? options?.startLine ?? 1;
  let newLineNo = options?.newStartLine ?? options?.startLine ?? 1;
  let singleNo = options?.startLine ?? 1;

  const mark = options?.markApproximate ? "~" : "";

  for (const change of changes) {
    for (const line of splitLines(change.value)) {
      let num: number;
      if (singleMode) {
        num = singleNo;
      } else {
        num = change.added ? newLineNo : oldLineNo;
      }
      const prefix = change.added ? "+" : change.removed ? "-" : " ";
      const numStr = options?.lineNumbers === false ? "" : `${String(num).padStart(4, " ")} `;
      const text = `${mark}${numStr}${prefix} ${line}`;
      if (options?.plain) {
        lines.push(text);
      } else if (options?.ansi) {
        const code = change.added ? "\x1b[32m" : change.removed ? "\x1b[31m" : "\x1b[0m";
        lines.push(`${code}${text}\x1b[0m`);
      } else {
        const cls = change.added ? "diff-add" : change.removed ? "diff-remove" : "diff-context";
        const color = change.added ? "#388e3c" : change.removed ? "#d32f2f" : "inherit";
        lines.push(`<span class="${cls}" style="color:${color}">${escapeHtml(text)}</span>`);
      }
      if (singleMode) {
        singleNo++;
      } else {
        if (change.added) newLineNo++;
        else if (change.removed) oldLineNo++;
        else { oldLineNo++; newLineNo++; }
      }
    }
  }

  let out = lines.join("\n");
  if (options?.filePath) {
    const header = options.plain || options.ansi
      ? `--- ${options.filePath}${options.markApproximate ? " (approx)" : ""}`
      : `<div class="diff-file" style="font-weight:bold">${escapeHtml(options.filePath)}${options.markApproximate ? " (approx)" : ""}</div>`;
    out = `${header}\n${out}`;
  }
  return out;
}

/** HTML variant (explicit). */
export function colorDiffHtml(oldText: string, newText: string, options?: ColorDiffOptions): string {
  return `<pre class="color-diff">${colorDiff(oldText, newText, options)}</pre>`;
}

/** ANSI variant (explicit). */
export function colorDiffAnsi(oldText: string, newText: string, options?: ColorDiffOptions): string {
  return colorDiff(oldText, newText, { ...options, ansi: true });
}

/** Plain variant (explicit). */
export function colorDiffPlain(oldText: string, newText: string, options?: ColorDiffOptions): string {
  return colorDiff(oldText, newText, { ...options, plain: true });
}


/** Convenience: build a diff from a Write/Edit tool object. */
export function colorDiffForTool(tool: any): string {
  if (!tool || !tool.input) return "";
  const name = String(tool.name || "").toLowerCase();
  const filePath = tool.input.file_path || tool.input.path || tool.input.filePath;
  const oldText = name === "edit" ? (tool.input.old_string ?? "") : "";
  const newText = name === "edit" ? (tool.input.new_string ?? "") : (tool.input.content ?? "");
  const resolved = resolveEditStartLine(filePath, oldText, newText);
  const opts: ColorDiffOptions = {
    filePath,
    lineNumbers: true,
    oldStartLine: resolved.oldStartLine,
    newStartLine: resolved.newStartLine,
    markApproximate: resolved.confidence !== "exact",
  };
  if (name === "edit") {
    return colorDiffHtml(oldText, newText, opts);
  }
  if (name === "write") {
    return colorDiffHtml("", newText, { ...opts, oldStartLine: 1, newStartLine: 1 });
  }
  return "";
}
