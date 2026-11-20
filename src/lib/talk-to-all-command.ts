import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { ancestorPids, deliver, liveSessions } from "./peer";
import { filterStatusField } from "./flags";
import {
  describeSessionFilter,
  matchesSessionFilter,
  readTranscriptMeta,
  type SessionFilter,
} from "./sessions";

// Quoted, kebab-case keys: the CLI normalises camelCase fields to `--kebab-case`
// flags, so a camelCase key here would never receive the flag's value.
export const TalkToAllArgsSchema = z.object({
  message: z.string().min(1).describe("Message to deliver to every active session's agent"),
  self: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also send to the session running this command (skipped by default)"),
  "filter-name": z
    .string()
    .optional()
    .describe(
      "Only send to sessions whose name matches any of these comma-separated texts (case-insensitive)",
    ),
  "filter-status": filterStatusField,
  "filter-hero": z
    .string()
    .optional()
    .describe(
      "Only send to sessions whose deployed hero matches any of these comma-separated names (case-insensitive)",
    ),
});

export type TalkToAllArgs = z.infer<typeof TalkToAllArgsSchema>;

export interface TalkToAllDeps {
  liveSessions?: () => Promise<import("./peer").LiveSession[]>;
  ancestorPids?: () => Set<number>;
  deliver?: (session: import("./peer").LiveSession, message: string) => Promise<string>;
}

export async function talkToAll(args: TalkToAllArgs, deps?: TalkToAllDeps) {
  const liveSessionsFn = deps?.liveSessions ?? liveSessions;
  const ancestorPidsFn = deps?.ancestorPids ?? ancestorPids;
  const deliverFn = deps?.deliver ?? deliver;
  const filter: SessionFilter = {
    filterName: args["filter-name"],
    filterStatus: args["filter-status"],
    filterHero: args["filter-hero"],
  };

  const all = await liveSessionsFn();
  // Hero lives in the transcript, not the live session file, so read each
  // candidate's meta when filtering by hero.
  if (filter.filterHero !== undefined) {
    const metas = await Promise.all(
      all.map(async (s) => ({ s, meta: await readTranscriptMeta(s) })),
    );
    for (const { s, meta } of metas) (s as import("./peer").LiveSession & { hero?: string | null }).hero = meta.hero ?? null;
  }

  // The calling Claude session is this process's ancestor — the walk covers the
  // shell a `!` command runs through, which ppid alone would miss.
  const skip = args.self ? new Set<number>() : ancestorPidsFn();
  const targets = all.filter((s) => !skip.has(s.pid) && matchesSessionFilter(s, filter));

  if (targets.length === 0) {
    const filters = describeSessionFilter(filter);
    return {
      success: false,
      message: `No active sessions${filters} to send to. Try: use-code-cli sessions`,
    };
  }

  const results = await Promise.all(
    targets.map(async (s) => {
      const label = s.name ?? s.sessionId;
      try {
        const msgId = await deliverFn(s, args.message);
        return { ok: true, pid: s.pid, name: label, msgId, error: "" };
      } catch (err) {
        return { ok: false, pid: s.pid, name: label, msgId: "", error: (err as Error).message };
      }
    }),
  );

  const sent = results.filter((r) => r.ok).length;
  const lines = results.map((r) =>
    r.ok ? `  ok    ${r.name} (pid ${r.pid})` : `  FAIL  ${r.name} (pid ${r.pid}): ${r.error}`,
  );
  return {
    success: sent > 0,
    message: `Sent to ${sent}/${results.length} active sessions\n${lines.join("\n")}`,
    data: results,
  };
}
