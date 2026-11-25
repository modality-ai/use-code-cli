import { homedir } from "node:os";
import { filterByProject } from "../../lib/filterProject";
import { z } from "zod";
import { optionalValueFlag, type CLICommand } from "modality-cli-kit";
import { formatTime, oneLine, plural } from "../../lib/output/format";
import {
  readMemoryFiles,
  searchMemoryFile,
  summarizeMemoryFile,
  type MemoryFile,
} from "../../lib/memory";

const MemoryArgsSchema = z.object({
  search: z
    .string()
    .min(1)
    .optional()
    .describe("Only memory files containing this text (case-insensitive)"),
  files: z
    .boolean()
    .optional()
    .default(false)
    .describe("List every memory file as one path per line, without summaries or a default limit"),
  limit: optionalValueFlag("20")
    .refine(
      (v) => v === undefined || v === "" || (/^\d+$/.test(v) && Number(v) > 0),
      "must be a positive integer, e.g. --limit 5",
    )
    .describe("Show at most N memory files (20 when passed bare; every match with --search)"),
  "filter-project": optionalValueFlag(process.cwd())
    .describe("Only memory files whose project workspace folder matches any of these comma-separated keywords (case-insensitive). Passed bare, defaults to the current working directory."),
});

export type MemoryArgs = z.infer<typeof MemoryArgsSchema>;

export interface MemoryDeps {
  readMemoryFiles?: () => Promise<import("../../lib/memory").MemoryFile[]>;
  searchMemoryFile?: (f: import("../../lib/memory").MemoryFile, term: string) => Promise<{ matches: number; line: number; snippet: string }>;
  summarizeMemoryFile?: (f: import("../../lib/memory").MemoryFile) => Promise<string | undefined>;
  filterByProject?: <T>(items: T[], pick: (item: T) => string[], keywords: string | string[] | undefined) => T[];
}

interface Row {
  project: string;
  cwd: string;
  file: string;
  path: string;
  updatedAt: number;
  matches?: number;
  line?: number;
  snippet?: string;
  summary?: string;
}

function baseRow(f: MemoryFile): Row {
  return {
    project: f.project,
    cwd: f.cwd,
    file: f.file,
    path: f.path,
    updatedAt: f.updatedAt,
  };
}

function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

async function memory(args: MemoryArgs, deps?: MemoryDeps) {
  const term = args.search;
  // Listing shows the newest 20 by default; --files lists every file, and a
  // search shows every match unless --limit is set.
  const limit = args.limit
    ? Number(args.limit)
    : term === undefined && !args.files
      ? 20
      : undefined;

  const readMemoryFilesFn = deps?.readMemoryFiles ?? readMemoryFiles;
  const allRaw = await readMemoryFilesFn(); // already newest first
  const filterByProjectFn = deps?.filterByProject ?? filterByProject;
  const all = filterByProjectFn(allRaw, (f) => [f.cwd], args["filter-project"]);
  let rows: Row[];
  let total: number;

  // --files lists paths, so sort them by name for a stable, scannable listing.
  if (term !== undefined) {
    const matched: { f: MemoryFile; matches: number; line: number; snippet: string }[] = [];
    for (const f of all) {
      const match = await (deps?.searchMemoryFile ?? searchMemoryFile)(f, term);
      if (match.matches > 0) matched.push({ f, ...match });
    }
    if (args.files) matched.sort((a, b) => a.f.path.localeCompare(b.f.path));
    total = matched.length;
    rows = matched.slice(0, limit).map(({ f, matches, line, snippet }) => ({
      ...baseRow(f),
      matches,
      line,
      snippet,
    }));
  } else {
    total = all.length;
    const ordered = args.files
      ? [...all].sort((a, b) => a.path.localeCompare(b.path))
      : all;
    const shown = ordered.slice(0, limit);
    // --files never prints a summary, so skip reading each file's body.
    rows = args.files
      ? shown.map(baseRow)
      : await Promise.all(
          shown.map(async (f) => ({
            ...baseRow(f),
            summary: await (deps?.summarizeMemoryFile ?? summarizeMemoryFile)(f),
          })),
        );
  }

  const hidden = total - rows.length;
  const lines = args.files
    ? rows.map((r) => shortPath(r.path))
    : rows.flatMap((r) => {
        const head = `${formatTime(r.updatedAt) || "—"}  ${r.cwd}  memory/${r.file}`;
        const detail =
          r.matches !== undefined
            ? `    match: ${r.matches} hit${r.matches === 1 ? "" : "s"} · line ${r.line} · "${r.snippet}"`
            : r.summary
              ? `    "${oneLine(r.summary, 140)}"`
              : "";
        return detail ? [head, detail] : [head];
      });
  if (hidden > 0 && !args.files) {
    lines.push(
      `… ${hidden} older memory file${hidden === 1 ? "" : "s"} hidden; raise --limit to see more.`,
    );
  }

  const message = lines.length
    ? lines.join("\n")
    : term !== undefined
      ? `No memory files contain "${term}" (searched ${plural(all.length, "file")}).`
      : args["filter-project"] !== undefined
        ? `No memory files matching --filter-project=${args["filter-project"]}.`
        : "No memory files found in ~/.claude/projects/*/memory.";

  return {
    success: true,
    message,
    data: rows.map((r) => ({
      project: r.project,
      cwd: r.cwd,
      file: r.file,
      path: r.path,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      matches: r.matches ?? null,
      line: r.line ?? null,
      snippet: r.snippet ?? null,
      summary: r.summary ?? null,
    })),
  };
}

export const memoryCommand: CLICommand<MemoryDeps, MemoryArgs, any> = {
  name: "memory",
  aliases: ["memories", "memory-search"],
  description: "List and search memory files across projects",
  inputSchema: MemoryArgsSchema,
  execute: (args) => memory(args as MemoryArgs),
  create: (deps) => (args) => memory(args as MemoryArgs, deps),
};
