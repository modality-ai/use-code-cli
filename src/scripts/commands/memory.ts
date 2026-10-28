import { homedir } from "node:os";
import { z } from "zod";
import { optionalValueFlag, type CLICommand } from "modality-cli-kit";
import { formatTime, oneLine, plural } from "../../lib/format";
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
});

type MemoryArgs = z.infer<typeof MemoryArgsSchema>;

/** One memory file as the command reports it. */
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

/** A path with the home prefix shortened to `~`, for the `--files` listing. */
function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

async function memory(args: MemoryArgs) {
  const term = args.search;
  // Listing shows the newest 20 by default; --files lists every file, and a
  // search shows every match unless --limit is set.
  const limit = args.limit
    ? Number(args.limit)
    : term === undefined && !args.files
      ? 20
      : undefined;

  const all = await readMemoryFiles(); // already newest first
  let rows: Row[];
  let total: number;

  if (term !== undefined) {
    const matched: { f: MemoryFile; matches: number; line: number; snippet: string }[] = [];
    for (const f of all) {
      const match = await searchMemoryFile(f, term);
      if (match.matches > 0) matched.push({ f, ...match });
    }
    total = matched.length;
    rows = matched.slice(0, limit).map(({ f, matches, line, snippet }) => ({
      ...baseRow(f),
      matches,
      line,
      snippet,
    }));
  } else {
    total = all.length;
    const shown = all.slice(0, limit);
    // --files never prints a summary, so skip reading each file's body.
    rows = args.files
      ? shown.map(baseRow)
      : await Promise.all(
          shown.map(async (f) => ({
            ...baseRow(f),
            summary: await summarizeMemoryFile(f),
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

export const memoryCommand: CLICommand = {
  name: "memory",
  aliases: ["memories", "memory-search"],
  description:
    "List Claude Code agent memory files; search their content with --search, or list every file with --files",
  inputSchema: MemoryArgsSchema,
  usage: ["use-code-cli memory [search] [--files] [--limit <n>]"],
  positionalKeys: ["search"],
  execute: memory,
  examples: [
    "use-code-cli memory",
    "use-code-cli memory --files",
    "use-code-cli memory --limit 5",
    'use-code-cli memory --search "deploy"',
    'use-code-cli memory "deploy" --files',
    'use-code-cli memory "deploy" --json',
  ],
};
