import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import {
  ancestorPids,
  currentSession,
  deliver,
  liveSessions,
  type LiveSession,
} from "../../lib/peer";
import {
  appendReplyInstruction,
  hasReplyInstruction,
  isAutoReply,
} from "../../lib/reply";
import { findReply, recordReply } from "../../lib/reply-ledger";
import { sessionLabel as label } from "../../lib/sessions";
import {
  matchesSessionFilter,
  readSessions,
  readTranscriptMeta,
} from "../../lib/sessions";

// Quoted, kebab-case keys: the CLI normalises camelCase fields to `--kebab-case`
// flags, so a camelCase key here would never receive the flag's value.
const TalkHeroArgsSchema = z.object({
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

type TalkHeroArgs = z.infer<typeof TalkHeroArgsSchema>;

type ReplyHint =
  | "appended"
  | "already-present"
  | "auto-reply"
  | "disabled"
  | "skipped-no-sender";

async function talkHero(args: TalkHeroArgs) {
  const hero = args.hero;
  const inReplyTo = args["in-reply-to"];

  if (!hero) {
    return {
      success: false,
      message: 'Hero name required. Usage: use-code-cli talk-hero <hero> "your message"',
    };
  }

  let { message } = args;

  if (message === undefined) {
    return {
      success: false,
      message: `Message required. Usage: use-code-cli talk-hero ${hero} "your message"`,
    };
  }

  // Search sessions in the current project (cwd), reading each transcript for
  // its deployed hero, and pick the first whose hero matches the keyword.
  const all = await readSessions(false);
  const projectSessions = all.filter(
    (s) => s.online && matchesSessionFilter(s, { filterProject: process.cwd() }),
  );

  const metas = await Promise.all(
    projectSessions.map(async (s) => ({ s, meta: await readTranscriptMeta(s) })),
  );
  const term = hero.toLowerCase();
  const matches = metas.filter(({ meta }) => (meta.hero ?? "").toLowerCase().includes(term));

  if (matches.length === 0) {
    return {
      success: false,
      message: `No active session with hero matching "${hero}" in this project. Try: use-code-cli sessions --filter-hero ${hero} --filter-project ${process.cwd()}`,
    };
  }

  const session = matches[0]!.s;

  // One inbound message, one answer.
  if (inReplyTo && !args.force) {
    const previous = await findReply(inReplyTo, session.sessionId);
    if (previous) {
      return {
        success: false,
        message: `Already replied to msg_id=${inReplyTo} for ${label(session)} at ${new Date(previous.at).toISOString()} (msg_id=${previous.msgId}). Pass --force to send again.`,
      };
    }
  }

  const sessions = await liveSessions();
  const sender = await currentSession(sessions);
  const senderName = sender ? label(sender) : undefined;

  let replyHint: ReplyHint;
  if (args["one-way"]) {
    replyHint = "disabled";
  } else if (!senderName) {
    replyHint = "skipped-no-sender";
  } else if (hasReplyInstruction(message)) {
    replyHint = "already-present";
  } else if (isAutoReply(message)) {
    replyHint = "auto-reply";
  } else {
    replyHint = "appended";
  }

  const msgId = randomUUID();
  const body =
    replyHint === "appended"
      ? appendReplyInstruction(message, senderName!, { msgId, inReplyTo })
      : message;

  try {
    await deliver(session as LiveSession, body, msgId);
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }

  const notes: string[] = [];
  if (replyHint === "skipped-no-sender") {
    notes.push("could not determine the sender session — reply instruction skipped.");
  }
  if (replyHint === "auto-reply") {
    notes.push("message looks like an automatic reply — no reply instruction appended.");
  }

  if (inReplyTo) {
    try {
      await recordReply({
        inReplyTo,
        targetSessionId: session.sessionId,
        msgId,
        at: Date.now(),
      });
    } catch (err) {
      notes.push(
        `LEDGER NOT UPDATED (${(err as Error).message}): a duplicate answer to msg_id=${inReplyTo} will not be blocked.`,
      );
    }
  }

  const note = notes.map((n) => `\nNote: ${n}`).join("");

  return {
    success: true,
    message: `Sent to ${label(session)} (pid ${session.pid}) msg_id=${msgId}${note}`,
    data: {
      pid: session.pid,
      sessionId: session.sessionId,
      msgId,
      sender: senderName ?? null,
      inReplyTo: inReplyTo ?? null,
      replyHint,
    },
  };
}

export const talkHeroCommand: CLICommand = {
  name: "talk-hero",
  description: "Talk to the first active session in this project whose deployed hero matches a keyword",
  inputSchema: TalkHeroArgsSchema,
  usage: [
    'use-code-cli talk-hero <hero> "message" [--one-way] [--in-reply-to <msg_id>]',
    'use-code-cli talk-hero <hero> [flags] --- message text (literal; stdin if empty)',
  ],
  positionalKeys: ["hero", "message"],
  execute: talkHero,
  examples: [
    'use-code-cli talk-hero wanda "please review the design"',
    'use-code-cli talk-hero JAMES "status?" --one-way',
  ],
};
