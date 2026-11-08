import { z } from "zod";
import { optionalValueFlag, renderTable, type CLICommand } from "modality-cli-kit";
import { formatTime, oneLine, plural } from "../../lib/output/format";
import { filterStatusField } from "../../lib/flags";
import {
  describeSessionFilter,
  findSessions,
  matchesSessionFilter,
  readMonitors,
  readSessions,
  readTranscriptMeta,
  sessionLabel,
  type SessionFilter,
  type SessionInfo,
  type SessionMonitor,
} from "../../lib/sessions";
import { deliver, liveSessions } from "../../lib/peer";

const MonitorsArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .optional()
    .describe("Limit to one session, or a monitor id for detail/stop"),
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also include offline sessions (monitors are then last known)"),
  "filter-name": z
    .string()
    .optional()
    .describe("Only sessions whose name matches any of these comma-separated texts (case-insensitive)"),
  "filter-status": filterStatusField,
  "filter-hero": z
    .string()
    .optional()
    .describe("Only sessions whose hero matches any of these comma-separated names (case-insensitive)"),
  "filter-project": optionalValueFlag(process.cwd())
    .describe("Only sessions whose workspace folder matches any of these comma-separated keywords (case-insensitive). Passed bare, defaults to the current working directory."),
  search: z
    .string()
    .min(1)
    .optional()
    .describe("Only monitors whose description contains this text (case-insensitive)"),
  limit: optionalValueFlag("20")
    .refine(
      (v) => v === undefined || v === "" || (/^\d+$/.test(v) && Number(v) > 0),
      "must be a positive integer, e.g. --limit 5",
    )
    .describe("Show at most N monitors (20 when passed bare)"),
  stop: z
    .boolean()
    .optional()
    .default(false)
    .describe("Ask the owning session to stop this monitor via TaskStop (session-only; requires it online)"),
});

type MonitorsArgs = z.infer<typeof MonitorsArgsSchema>;

interface Row {
  session: string;
  sessionId: string;
  online: boolean;
  id: string;
  description: string;
  timeoutMs: number | null;
  createdAt: number | null;
  line: number;
}

const READ_CONCURRENCY = 8;

async function monitorRows(list: SessionInfo[], term: string | undefined): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < list.length; i += READ_CONCURRENCY) {
    const batch = list.slice(i, i + READ_CONCURRENCY);
    const found = await Promise.all(
      batch.map(async (s) => ({ s, monitors: await readMonitors(s) })),
    );
    for (const { s, monitors } of found) {
      for (const m of monitors) {
        if (term !== undefined && !(m.description ?? "").toLowerCase().includes(term.toLowerCase())) continue;
        rows.push({
          session: sessionLabel(s),
          sessionId: s.sessionId,
          online: s.online,
          id: m.id,
          description: m.description ?? "",
          timeoutMs: m.timeoutMs ?? null,
          createdAt: m.createdAt ?? null,
          line: m.line,
        });
      }
    }
  }
  return rows;
}

async function monitors(args: MonitorsArgs) {
  // Stop mode: target is a monitor id.
  if (args.stop) {
    if (!args.target) {
      return { success: false, message: "Monitor id required. Usage: use-code-cli monitor <id> --stop" };
    }
    const allSessions = await readSessions(true);
    const rows = await monitorRows(allSessions, undefined);
    const matches = rows.filter((r) => r.id === args.target);
    if (matches.length === 0) {
      return { success: false, message: `No monitor with id "${args.target}". Try: use-code-cli monitors --all` };
    }
    const r = matches[0] as Row;
    if (!r.online) {
      return {
        success: false,
        message: `Monitor ${r.id} belongs to offline session ${r.session}; cannot stop it (monitors are session-only). Start the session and run TaskStop({task_id: "${r.id}"}) inside it.`,
      };
    }
    const live = await liveSessions();
    const session = live.find((s) => s.sessionId === r.sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${r.session} is not reachable for messaging. Run TaskStop({task_id: "${r.id}"}) inside it.`,
      };
    }
    try {
      await deliver(session, `Please stop background monitor ${r.id} ("${r.description}") by calling TaskStop({task_id: "${r.id}"}).`);
      return {
        success: true,
        message: `Asked session ${r.session} to stop monitor ${r.id}. (Monitors are session-only; the session must execute TaskStop.)`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Could not message session ${r.session}: ${reason}. Run TaskStop({task_id: "${r.id}"}) inside it.`,
      };
    }
  }

  let detailId: string | undefined;
  let list: SessionInfo[];
  if (args.target) {
    const live = await readSessions(false);
    let matches = findSessions(live, args.target);
    if (matches.length === 0) {
      matches = findSessions(await readSessions(true), args.target);
    }
    if (matches.length > 0) {
      if (matches.length > 1) {
        const rows = matches.map((s) => `  ${sessionLabel(s)}  pid=${s.pid}  ${s.cwd}`).join("\n");
        return { success: false, message: `"${args.target}" is ambiguous; use a full name or pid:\n${rows}` };
      }
      list = [matches[0] as SessionInfo];
    } else {
      detailId = args.target;
      list = await readSessions(true);
    }
  } else {
    const includeOffline = args.all === true;
    const all = await readSessions(includeOffline);
    const fieldFilter: SessionFilter = {
      filterName: args["filter-name"],
      filterStatus: args["filter-status"],
      filterProject: args["filter-project"],
    };
    const filter: SessionFilter = { ...fieldFilter, filterHero: args["filter-hero"] };
    let candidates = (includeOffline ? all : all.filter((s) => s.online)).filter((s) =>
      matchesSessionFilter(s, fieldFilter),
    );
    if (filter.filterHero !== undefined) {
      const read = await Promise.all(candidates.map(async (s) => ({ s, meta: await readTranscriptMeta(s) })));
      candidates = read
        .filter(({ s, meta }) => matchesSessionFilter({ ...s, hero: meta.hero }, filter))
        .map(({ s }) => s);
    }
    list = candidates;
  }

  const rows = await monitorRows(list, args.search);
  if (detailId !== undefined) {
    const matches = rows.filter((r) => r.id === detailId);
    if (matches.length === 0) {
      return { success: false, message: `No monitor with id "${detailId}". Try: use-code-cli monitors --all` };
    }
    const r = matches[0] as Row;
    const lines = [
      `${r.id}`,
      `  session:     ${r.session} (${r.sessionId})`,
      `  state:       ${r.online ? "running" : "last known (session ended)"}`,
      `  description: ${r.description || "—"}`,
      `  timeout:     ${r.timeoutMs !== null ? `${r.timeoutMs}ms` : "—"}`,
      `  created:     ${r.createdAt !== null ? formatTime(r.createdAt) : "—"}`,
      `  transcript:  line ${r.line}`,
      ``,
      `Stop it: use-code-cli monitor ${r.id} --stop`,
    ];
    console.log(lines.join("\n"));
    return {
      success: true,
      message: undefined,
      data: {
        session: r.session,
        sessionId: r.sessionId,
        online: r.online,
        id: r.id,
        description: r.description || null,
        timeoutMs: r.timeoutMs,
        createdAt: r.createdAt !== null ? new Date(r.createdAt).toISOString() : null,
        line: r.line,
      },
    };
  }
  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  const hidden = rows.length - shown.length;

  if (shown.length > 0) {
    const headers = ["session", "id", "description", "timeout", "created"];
    const tableRows = shown.map((r) => [
      r.session,
      r.id,
      oneLine(r.description || "—", 40),
      r.timeoutMs !== null ? `${r.timeoutMs}ms` : "—",
      r.createdAt !== null ? formatTime(r.createdAt) : "—",
    ]);
    renderTable(headers, tableRows);

    const largeLines: string[] = [];
    for (const r of shown) {
      largeLines.push(`${r.session} · ${r.id}:`);
      if (r.description) largeLines.push(`  desc: "${oneLine(r.description, 200)}"`);
      largeLines.push(`  timeout: ${r.timeoutMs !== null ? `${r.timeoutMs}ms` : "—"}`);
      largeLines.push(`  created: ${r.createdAt !== null ? formatTime(r.createdAt) : "—"}`);
      largeLines.push(`  state: ${r.online ? "running" : "last known (session ended)"}`);
      largeLines.push("");
    }
    console.log();
    for (const l of largeLines) console.log(l);
  }

  if (hidden > 0) {
    console.log(`… ${hidden} older monitor${hidden === 1 ? "" : "s"} hidden; raise --limit to see more.`);
  }

  const message =
    shown.length === 0
      ? args.search !== undefined
        ? `No monitors match "${args.search}".`
        : args.all
          ? "No monitors found."
          : "No monitors found. Use --all to include offline sessions."
      : undefined;

  return {
    success: true,
    message,
    data: shown.map((r) => ({
      session: r.session,
      sessionId: r.sessionId,
      online: r.online,
      id: r.id,
      description: r.description || null,
      timeoutMs: r.timeoutMs,
      createdAt: r.createdAt !== null ? new Date(r.createdAt).toISOString() : null,
      line: r.line,
    })),
  };
}

export const monitorsCommand: CLICommand = {
  name: "monitors",
  aliases: ["monitor"],
  description: "List background monitors recovered from session transcripts (read-only; --stop asks the owning session to stop one)",
  inputSchema: MonitorsArgsSchema,
  positionalKeys: ["target"],
  execute: monitors,
  examples: [
    "use-code-cli monitors",
    "use-code-cli monitors --all",
    "use-code-cli monitors use-stock-ee",
    "use-code-cli monitors bjlfsk57o",
    "use-code-cli monitor bjlfsk57o --stop",
  ],
};
