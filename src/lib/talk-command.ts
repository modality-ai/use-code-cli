import { z } from "zod";
import { ancestorPids, liveSessions, type LiveSession } from "./peer";
import { sendWithReply } from "./reply-send";
import { readStdinMessageOrUndefined } from "./talk-argv";
import { sessionLabel as label } from "./sessions";

export const TalkArgsSchema = z.object({
  target: z
    .string()
    .optional()
    .describe("Session name, pid, or sessionId — omit to use the only active session"),
  message: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Message to deliver to the session's agent. For literal text use '--- <message>' or stdin: the shell still expands $VAR, backticks and ! in unquoted words.",
    ),
  // Quoted, kebab-case key: the CLI normalises camelCase fields to `--kebab-case`
  // flags, so a camelCase key here would never receive the flag's value.
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

export type TalkArgs = z.infer<typeof TalkArgsSchema>;

export interface TalkDeps {
  liveSessions?: () => Promise<LiveSession[]>;
  ancestorPids?: () => Set<number>;
  readStdinMessageOrUndefined?: () => Promise<string | undefined>;
  sendWithReply?: (args: {
    session: LiveSession;
    message: string;
    sessions: LiveSession[];
    oneWay?: boolean;
    inReplyTo?: string;
    force?: boolean;
  }) => Promise<{ success: boolean; message: string }>;
  label?: (session: LiveSession) => string;
}

function findTargets(sessions: LiveSession[], target: string): LiveSession[] {
  return sessions.filter(
    (s) =>
      String(s.pid) === target ||
      s.sessionId === target ||
      s.name === target,
  );
}

function describeAll(sessions: LiveSession[], labelFn: (s: LiveSession) => string): string {
  return sessions.map((s) => `  ${s.pid} ${labelFn(s)} ${s.cwd}`).join("\n");
}

/** Every live session except the one that launched this CLI. */
function autoTargets(sessions: LiveSession[], ancestors: Set<number>): LiveSession[] {
  return sessions.filter((s) => !ancestors.has(s.pid));
}

export async function talk(args: TalkArgs, deps?: TalkDeps) {
  const liveSessionsFn = deps?.liveSessions ?? liveSessions;
  const ancestorPidsFn = deps?.ancestorPids ?? ancestorPids;
  const readStdinFn = deps?.readStdinMessageOrUndefined ?? readStdinMessageOrUndefined;
  const sendWithReplyFn = deps?.sendWithReply ?? sendWithReply;
  const labelFn = deps?.label ?? label;

  const sessions = await liveSessionsFn();
  let { target, message } = args;
  const inReplyTo = args["in-reply-to"];

  // `talk "hello"` parses as a lone target. When it names no session it is the
  // message, and the target is picked automatically; when it does name one the
  // message comes from piped stdin, read below once the session is resolved.
  if (
    message === undefined &&
    target !== undefined &&
    findTargets(sessions, target).length === 0
  ) {
    message = target;
    target = undefined;
  }

  let session: LiveSession | undefined;
  if (target !== undefined) {
    const matches = findTargets(sessions, target);
    if (matches.length > 1) {
      return {
        success: false,
        message: `"${target}" is ambiguous; use a pid:\n${describeAll(matches, labelFn)}`,
      };
    }
    session = matches[0];
    if (!session) {
      return {
        success: false,
        message: `No active session matches "${target}". Try: use-code-cli sessions`,
      };
    }
  } else {
    const ancestors = ancestorPidsFn();
    const candidates = autoTargets(sessions, ancestors);
    if (candidates.length > 1) {
      return {
        success: false,
        message: `${candidates.length} active sessions — add a target:\n${describeAll(candidates, labelFn)}`,
      };
    }
    session = candidates[0];
    if (!session) {
      return {
        success: false,
        message:
          sessions.length > 0
            ? "No other active sessions (the sender is the only one). Try: use-code-cli sessions"
            : "No active sessions. Try: use-code-cli sessions",
      };
    }
  }

  if (message === undefined) {
    // Piped or heredoc stdin carries the message when the argument is omitted;
    // on a terminal or blank input there is nothing to read.
    message = await readStdinFn();
    if (message === undefined) {
      return {
        success: false,
        message:
          target !== undefined
            ? `Message required. Usage: use-code-cli talk ${target} "your message"`
            : 'Message required. Usage: use-code-cli talk [target] "your message"',
      };
    }
  }

  return sendWithReplyFn({
    session,
    message,
    sessions,
    oneWay: args["one-way"],
    inReplyTo,
    force: args.force,
  });
}
