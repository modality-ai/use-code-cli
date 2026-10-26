import { z } from "zod";
import { optionalValueFlag, type CLICommand } from "modality-cli-kit";
import { oneLine } from "../../lib/format";
import {
  describeSessionFilter,
  filterStatusField,
  matchesSessionFilter,
  readSessions,
  readTranscriptMeta,
  searchTranscript,
  type SessionFilter,
  type SessionInfo,
  type TranscriptMeta,
} from "../../lib/sessions";

// Quoted, kebab-case keys: the CLI normalises camelCase fields to `--kebab-case`
// flags, so a camelCase key here would never receive the flag's value.
const SessionsArgsSchema = z.object({
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also list offline sessions (process no longer running)"),
  "filter-name": z
    .string()
    .optional()
    .describe(
      "Only sessions whose name matches any of these comma-separated texts (case-insensitive)",
    ),
  "filter-status": filterStatusField,
  recent: optionalValueFlag("10")
    .refine(
      (v) => v === undefined || v === "" || (/^\d+$/.test(v) && Number(v) > 0),
      "must be a positive integer, e.g. --recent 10",
    )
    .describe("Show only the newest N sessions, each with a transcript summary (10 when passed bare)"),
  search: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Search every session's transcript for this text (case-insensitive) and show each hit with its first match",
    ),
});

type SessionsArgs = z.infer<typeof SessionsArgsSchema>;

/** One session as the command reports it; summary/search fields appear per mode. */
interface Row {
  state: string;
  pid: number;
  name: string;
  status: string;
  cwd: string;
  sessionId: string;
  version: string;
  updatedAt: string;
  branch?: string | null;
  hero?: string | null;
  lastPrompt?: string | null;
  matches?: number;
  line?: number;
  snippet?: string;
}

/** How many transcripts to search at once — enough to hide I/O latency, few enough to spare fds. */
const SEARCH_CONCURRENCY = 8;

/** The branch / last-prompt line shown under a `--recent` row (hero is on the head line). */
function summaryLine(meta: { branch?: string; lastPrompt?: string }): string {
  return [
    meta.branch ? `branch=${meta.branch}` : "",
    meta.lastPrompt ? `last="${oneLine(meta.lastPrompt, 80)}"` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function baseRow(s: SessionInfo, meta: TranscriptMeta = {}): Row {
  return {
    state: s.online ? "active" : "offline",
    pid: s.pid,
    name: s.name ?? "",
    status: s.status ?? "",
    cwd: s.cwd,
    sessionId: s.sessionId,
    version: s.version ?? "",
    updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "",
    hero: meta.hero ?? null,
  };
}

/** Search the whole candidate list, keeping only sessions that contain the term. */
async function searchRows(list: SessionInfo[], term: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < list.length; i += SEARCH_CONCURRENCY) {
    const batch = list.slice(i, i + SEARCH_CONCURRENCY);
    const found = await Promise.all(
      batch.map(async (s) => {
        const [match, meta] = await Promise.all([
          searchTranscript(s, term),
          readTranscriptMeta(s),
        ]);
        return { s, meta, match };
      }),
    );
    for (const { s, meta, match } of found) {
      if (match.matches === 0) continue;
      rows.push({
        ...baseRow(s, meta),
        matches: match.matches,
        line: match.line,
        snippet: match.snippet,
      });
    }
  }
  return rows;
}

async function sessions(args: SessionsArgs) {
  const filter: SessionFilter = {
    filterName: args["filter-name"],
    filterStatus: args["filter-status"],
  };
  // Bare --recent arrives as "10"; absent and --no-recent mean no limit.
  const limit = args.recent ? Number(args.recent) : undefined;
  // Searching reads transcripts, so it applies to every known session, not just live ones.
  const includeOffline = args.all || args.search !== undefined;

  const all = await readSessions(includeOffline);
  const matching = (includeOffline ? all : all.filter((s) => s.online)).filter((s) =>
    matchesSessionFilter(s, filter),
  );
  const list = limit === undefined ? matching : matching.slice(0, limit);
  const hidden = matching.length - list.length;

  let rows: Row[];
  if (args.search !== undefined) {
    rows = await searchRows(list, args.search);
  } else {
    rows = await Promise.all(
      list.map(async (s) => {
        const meta = await readTranscriptMeta(s);
        return {
          ...baseRow(s, meta),
          branch: meta.branch ?? null,
          lastPrompt: meta.lastPrompt ?? null,
        };
      }),
    );
  }

  const filters = describeSessionFilter(filter);
  const lines = rows.flatMap((r) => {
    const head = `[${r.state}] ${r.name || r.sessionId}  pid=${r.pid}  ${r.status}  hero=${r.hero ?? "-"}  ${r.cwd}`;
    const detail =
      args.search !== undefined
        ? `match: ${r.matches} hit${r.matches === 1 ? "" : "s"} · line ${r.line} · "${r.snippet}"`
        : summaryLine({
            branch: r.branch ?? undefined,
            lastPrompt: r.lastPrompt ?? undefined,
          });
    return detail ? [head, `          ${detail}`] : [head];
  });
  if (hidden > 0) {
    lines.push(`… ${hidden} older session${hidden === 1 ? "" : "s"} hidden; raise --recent to see more.`);
  }

  const message = lines.length
    ? lines.join("\n")
    : args.search !== undefined
      ? `No sessions contain "${args.search}"${filters} (searched ${list.length}).`
      : args.all
        ? `No sessions found${filters}.`
        : `No active sessions${filters}. Use --all to include offline sessions.`;

  return { success: true, message, data: rows };
}

export const sessionsCommand: CLICommand = {
  name: "sessions",
  aliases: ["ls"],
  description: "List Claude Code CLI sessions (active by default)",
  inputSchema: SessionsArgsSchema,
  positionalKeys: [],
  execute: sessions,
  examples: [
    "use-code-cli sessions",
    "use-code-cli sessions --all",
    "use-code-cli sessions --all --recent",
    "use-code-cli sessions --all --recent 30",
    "use-code-cli sessions --filter-status busy",
    "use-code-cli sessions --filter-name use-design,use-stock",
    'use-code-cli sessions --search "use-code-cli talk"',
  ],
};
