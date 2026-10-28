import { join, relative } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { oneLine } from "./format";
import { readProjects } from "./projects";
import { PROJECTS_DIR } from "./sessions";

/** The directory Claude Code keeps agent memory in, inside each project dir. */
export const MEMORY_DIR_NAME = "memory";

/** One agent memory file under ~/.claude/projects/<project>/memory. */
export interface MemoryFile {
  /** Encoded project directory name under ~/.claude/projects. */
  project: string;
  /** Workspace path the project's transcripts record, or the encoded dir name. */
  cwd: string;
  /** Path inside the memory directory, e.g. `feedback-thing.md` or `sub/x.md`. */
  file: string;
  /** Absolute path on disk. */
  path: string;
  /** Last modification time, in epoch milliseconds. */
  updatedAt: number;
}

/** Where a search term occurred in a memory file. */
export interface MemoryMatch {
  /** Total occurrences across the whole file. */
  matches: number;
  /** 1-based line number of the first occurrence. */
  line: number;
  /** The first matching line, whitespace collapsed and clipped. */
  snippet: string;
}

const NO_MATCH: MemoryMatch = { matches: 0, line: 0, snippet: "" };

interface FoundFile {
  file: string;
  path: string;
  updatedAt: number;
}

/** Collect every regular file under `dir`, recursively, keyed by its path inside `base`. */
async function walk(dir: string, base: string, out: FoundFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, base, out);
    } else if (entry.isFile()) {
      try {
        out.push({ file: relative(base, path), path, updatedAt: (await stat(path)).mtimeMs });
      } catch {
        // Skip a file that vanished or cannot be read; the rest still count.
      }
    }
  }
}

/**
 * Every agent memory file across all projects, newest first.
 *
 * The memory directory lives beside the transcripts in the encoded project
 * folder, so the folder is walked directly — a project keeps its memory even
 * after its sessions age out. The workspace path comes from readProjects (the
 * transcripts record the real cwd); the encoded directory name is the fallback
 * when no transcript names it.
 */
export async function readMemoryFiles(): Promise<MemoryFile[]> {
  let projects: string[];
  try {
    projects = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }

  const found: { project: string; files: FoundFile[] }[] = [];
  for (const project of projects) {
    const base = join(PROJECTS_DIR, project, MEMORY_DIR_NAME);
    const files: FoundFile[] = [];
    await walk(base, base, files);
    if (files.length > 0) found.push({ project, files });
  }
  if (found.length === 0) return [];

  const cwdByDir = new Map((await readProjects()).map((p) => [p.dir, p.cwd]));
  return found
    .flatMap(({ project, files }) =>
      files.map((f) => ({
        project,
        cwd: cwdByDir.get(project) ?? project,
        ...f,
      })),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Non-overlapping occurrences of `needle` in `haystack`; both already lowercase. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    count++;
  }
  return count;
}

/**
 * Search one memory file for `term` (case-insensitive). Memory files are small,
 * so the whole file is read rather than streamed.
 */
export async function searchMemoryFile(f: MemoryFile, term: string): Promise<MemoryMatch> {
  let text: string;
  try {
    text = await readFile(f.path, "utf8");
  } catch {
    return NO_MATCH;
  }

  const needle = term.toLowerCase();
  const haystack = text.toLowerCase();
  const matches = countOccurrences(haystack, needle);
  if (matches === 0) return NO_MATCH;

  const first = haystack.indexOf(needle);
  const lineStart = text.lastIndexOf("\n", first) + 1;
  const lineEnd = text.indexOf("\n", first);
  const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  return {
    matches,
    line: text.slice(0, first).split("\n").length,
    snippet: oneLine(lineText, 140),
  };
}

/** The text after a leading YAML frontmatter block, or `text` unchanged. */
function withoutFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text : text.slice(end + 4);
}

/** The frontmatter `description:`, with surrounding quotes removed. */
function frontmatterDescription(text: string): string | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return undefined;

  const line = text
    .slice(3, end)
    .split("\n")
    .find((l) => l.trimStart().startsWith("description:"));
  if (!line) return undefined;

  const value = line.slice(line.indexOf(":") + 1).trim();
  const quote = value[0];
  return quote === '"' || quote === "'" ? value.slice(1, -1) : value;
}

/** A one-line gist of a memory file: its frontmatter description, else its first line. */
export async function summarizeMemoryFile(f: MemoryFile): Promise<string> {
  let text: string;
  try {
    text = await readFile(f.path, "utf8");
  } catch {
    return "";
  }

  const description = frontmatterDescription(text);
  if (description) return oneLine(description, 140);

  const body = withoutFrontmatter(text);
  const first = body.split("\n").find((line) => line.trim() !== "");
  return oneLine((first ?? "").replace(/^#+\s*/, ""), 140);
}
