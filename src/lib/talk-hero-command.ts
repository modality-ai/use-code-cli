import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { sendWithReply } from "./reply-send";
import { readStdinMessageOrUndefined } from "./talk-argv";
import { matchesProjectFolder, splitFilterProjectTerms } from "./filterProject";
import {
  readSessions,
  readTranscriptMeta,
} from "./sessions";

// Quoted, kebab-case keys: the CLI normalises camelCase fields to `--kebab-case`
// flags, so a camelCase key here would never receive the flag's value.
export const TalkHeroArgsSchema = z.object({
  hero: z
    .string()
    .min(1)
    .optional()
    .describe("Hero name keyword (case-insensitive) to find the target session"),
  message: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Message to deliver to the matching session's agent. For literal text use '--- <message>' or stdin: the shell still expands $VAR, backticks and ! in unquoted words.",
    ),
  "one-way": z
    .boolean()
    .optional()
    .describe("Send the message exactly as written — no reply instruction appended."),
  "in-reply-to": z
    .string()
    .optional()
    .describe(
      "msg_id of the message this answers — recorded so the same session cannot answer it twice",
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Send even when this session already answered --in-reply-to"),
});

export type TalkHeroArgs = z.infer<typeof TalkHeroArgsSchema>;

/** Injectable dependencies for testing (all optional; defaults preserve real behavior). */
export interface TalkHeroDeps {
  readSessions?: () => Promise<import("./sessions").SessionInfo[]>;
  readTranscriptMeta?: (s: import("./sessions").SessionInfo) => Promise<{ hero?: string }>;
  cwd?: () => string;
  readStdinMessageOrUndefined?: () => Promise<string | undefined>;
  sendWithReply?: (args: {
    session: import("./sessions").SessionInfo;
    message: string;
    oneWay?: boolean;
    inReplyTo?: string;
    force?: boolean;
    deps?: import("./reply-send").SendWithReplyDeps;
  }) => Promise<{ success: boolean; message: string; data?: unknown }>;
}

export async function talkHero(args: TalkHeroArgs, deps?: TalkHeroDeps) {
  const hero = args.hero;
  const inReplyTo = args["in-reply-to"];

  if (!hero) {
    return {
      success: false,
      message: 'Hero name required. Usage: use-code-cli talk-hero <hero> "your message"',
    };
  }

  // Search sessions in the current project (cwd), reading each transcript for
  // its deployed hero, and pick the first whose hero matches the keyword.
  const readSessionsFn = deps?.readSessions ?? (() => readSessions(false));
  const all = await readSessionsFn();
  const projectTerms = splitFilterProjectTerms((deps?.cwd ?? (() => process.cwd()))());
  const projectSessions = all.filter(
    (s) => s.online && matchesProjectFolder([s.cwd, s.latestCwd], projectTerms),
  );

  const metas = await Promise.all(
    projectSessions.map(async (s) => ({ s, meta: await (deps?.readTranscriptMeta ?? readTranscriptMeta)(s) })),
  );
  const term = hero.trim().toLowerCase();
  const matches = metas.filter(({ meta }) =>
    (meta.hero ?? "").trim().toLowerCase().includes(term),
  );

  if (matches.length === 0) {
    return {
      success: false,
      message: `No active session with hero matching "${hero}" in this project. Try: use-code-cli sessions --filter-hero ${hero} --filter-project ${process.cwd()}`,
    };
  }

  const session = matches[0]!.s;

  let { message } = args;
  if (message === undefined) {
    // Piped or heredoc stdin carries the message when the argument is omitted;
    // on a terminal or blank input there is nothing to read. Read it only once
    // the session is resolved, so a no-match error does not wait on stdin.
    message = await (deps?.readStdinMessageOrUndefined ?? readStdinMessageOrUndefined)();
    if (message === undefined) {
      return {
        success: false,
        message: `Message required. Usage: use-code-cli talk-hero ${hero} "your message"`,
      };
    }
  }

  const sendFn = deps?.sendWithReply ?? sendWithReply;
  return sendFn({ session, message, oneWay: args["one-way"], inReplyTo, force: args.force });
}

