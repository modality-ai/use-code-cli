import { z } from "zod";
import { optionalValueFlag, type CLICommand } from "modality-cli-kit";
import { formatTime, oneLine, plural } from "../../lib/format";
import { filterStatusField } from "../../lib/flags";
import {
  describeSessionFilter,
  findSessions,
  matchesSessionFilter,
  readPrompts,
  readSessions,
  sessionLabel,
  type SessionFilter,
  type SessionInfo,
} from "../../lib/sessions";

const PromptsArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Limit to one session: name, pid, or sessionId (a unique name prefix also works)",
    ),
  search: z
    .string()
    .min(1)
    .optional()
    .describe("Only prompts containing this text (case-insensitive)"),
  "filter-name": z
    .string()
    .optional()
    .describe(
      "Only prompts from sessions whose name matches any of these comma-separated texts (case-insensitive)",
    ),
  "filter-status": filterStatusField,
  limit: optionalValueFlag("20")
    .refine(
      (v) => v === undefined || v === "" || (/^\d+$/.test(v) && Number(v) > 0),
      "must be a positive integer, e.g. --limit 5",
    )
    .describe("Show at most N prompts (20 when passed bare; every match with --search)"),
  show: z
    .string()
    // The list prints the reference as `L389`; accept it verbatim so the number
    // can be copied straight out of the list into --show.
    .refine((v) => /^L?\d+$/i.test(v) && Number(v.replace(/^L/i, "")) > 0, "must be a prompt line number, e.g. --show 389")
    .optional()
    .describe("Print one prompt's full text, addressed by its line number"),
});

type PromptsArgs = z.infer<typeof PromptsArgsSchema>;

/** One prompt as the command reports it. */
interface Row {
  name: string;
  sessionId: string;
  cwd: string;
  kind: "typed" | "peer";
  timestamp: number;
  line: number;
  text: string;
}

/** How many transcripts to read at once — enough to hide I/O latency, few enough to spare fds. */
const READ_CONCURRENCY = 8;

/** Every prompt in `list`, newest first, keeping only matches when `term` is set. */
async function promptRows(list: SessionInfo[], term: string | undefined): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < list.length; i += READ_CONCURRENCY) {
    const batch = list.slice(i, i + READ_CONCURRENCY);
    const found = await Promise.all(
      batch.map(async (s) => ({ s, prompts: await readPrompts(s) })),
    );
    for (const { s, prompts } of found) {
      for (const p of prompts) {
        if (term !== undefined && !p.text.toLowerCase().includes(term)) continue;
        rows.push({
          name: sessionLabel(s),
          sessionId: s.sessionId,
          cwd: s.cwd,
          kind: p.kind,
          timestamp: p.timestamp ?? 0,
          line: p.line,
          text: p.text,
        });
      }
    }
  }
  return rows;
}

async function prompts(args: PromptsArgs) {
  const filter: SessionFilter = {
    filterName: args["filter-name"],
    filterStatus: args["filter-status"],
  };
  const term = args.search?.toLowerCase();
  // Prompts are historical, so offline sessions are searched too. Listing shows
  // the newest 20 by default; a search shows every match unless --limit is set.
  const limit = args.limit ? Number(args.limit) : term === undefined ? 20 : undefined;

  const all = await readSessions(true);
  let scope: SessionInfo[];
  let scopeLabel: string | undefined;
  if (args.target !== undefined) {
    // An explicit target wins over the session filters.
    const matches = findSessions(all, args.target);
    const only = matches.length === 1 ? matches[0] : undefined;
    if (!only) {
      if (matches.length > 1) {
        const rows = matches
          .map((s) => `  ${sessionLabel(s)}  pid=${s.pid}  ${s.cwd}`)
          .join("\n");
        return {
          success: false,
          message: `"${args.target}" is ambiguous; use a full name, sessionId, or pid:\n${rows}`,
        };
      }
      return {
        success: false,
        message: `No session matches "${args.target}". Try: use-code-cli sessions --all. To search every session: use-code-cli prompts --search "${args.target}"`,
      };
    }
    scope = [only];
    scopeLabel = sessionLabel(only);
  } else {
    scope = all.filter((s) => matchesSessionFilter(s, filter));
  }

  const rows = await promptRows(scope, term);
  rows.sort((a, b) => b.timestamp - a.timestamp);

  // --show dumps exactly one prompt: no list, no truncation, nothing else, so a
  // long prompt arrives whole and is not lost in a table of rows.
  if (args.show !== undefined) {
    const line = Number(args.show.replace(/^L/i, ""));
    const row = rows.find((r) => r.line === line);
    if (!row) {
      const where = scopeLabel
        ? ` in ${scopeLabel}`
        : term !== undefined
          ? ` matching "${args.search}"`
          : "";
      return {
        success: false,
        message: `No prompt at line ${line}${where}. Try: use-code-cli prompts --limit 5`,
      };
    }
    // `result`, not `message`: the human renderer prefixes a message with "✓",
    // which would land on the first line of a multi-line prompt.
    return {
      success: true,
      result: row.text,
      data: [
        {
          name: row.name,
          sessionId: row.sessionId,
          cwd: row.cwd,
          kind: row.kind,
          timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
          line: row.line,
          text: row.text,
        },
      ],
    };
  }

  const shown = limit === undefined ? rows : rows.slice(0, limit);
  const hidden = rows.length - shown.length;

  const lines = shown.map(
    (r) =>
      `${formatTime(r.timestamp) || "—"}  ${r.name}  [${r.kind}]  L${r.line}  "${oneLine(r.text, 140)}"`,
  );
  if (hidden > 0) {
    lines.push(
      `… ${hidden} older prompt${hidden === 1 ? "" : "s"} hidden; raise --limit to see more.`,
    );
  }

  const filters = describeSessionFilter(filter);
  // One blank line between rows: a wrapped prompt stays visually separate from
  // the next row instead of reading as its continuation.
  const message = lines.length
    ? lines.join("\n\n")
    : term !== undefined
      ? scopeLabel
        ? `No prompts contain "${args.search}" in ${scopeLabel}.`
        : `No prompts contain "${args.search}"${filters} (searched ${plural(scope.length, "session")}).`
      : scopeLabel
        ? `No prompts found in ${scopeLabel}.`
        : `No prompts found${filters}.`;

  return {
    success: true,
    message,
    data: shown.map((r) => ({
      name: r.name,
      sessionId: r.sessionId,
      cwd: r.cwd,
      kind: r.kind,
      timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
      line: r.line,
      text: r.text,
    })),
  };
}

export const promptsCommand: CLICommand = {
  name: "prompts",
  aliases: ["prompt-search"],
  description:
    "List the prompts sessions received; search only prompts with --search, or limit to one session with a target",
  inputSchema: PromptsArgsSchema,
  usage: [
    "use-code-cli prompts [target] [search] [--filter-name <names>] [--filter-status <statuses>] [--limit <n>] [--show <line>]",
  ],
  positionalKeys: ["target", "search"],
  execute: prompts,
  examples: [
    "use-code-cli prompts",
    "use-code-cli prompts --limit 5",
    "use-code-cli prompts --show 389",
    'use-code-cli prompts --search "deploy"',
    'use-code-cli prompts use-design-da "deploy"',
    "use-code-cli prompts 6385fd14-5baa-402e-a032-d11792946b19 deploy",
    'use-code-cli prompts use-design-da --search "deploy" --json',
  ],
};
