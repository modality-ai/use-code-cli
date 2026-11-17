import type { Readable } from "node:stream";

/** The command this preprocessor applies to. */
export const TALK_COMMAND_NAME = "talk";
export const TALK_HERO_COMMAND_NAME = "talk-hero";

/** The token that ends the CLI arguments and starts the literal message. */
export const MESSAGE_SEPARATOR = "---";

/** Cap on the piped-stdin read — a pipe held open by an unrelated process
 * (sharing the captured fd, e.g. a tunnel) must not hang the CLI forever. */
const STDIN_READ_TIMEOUT_MS = 10_000;

export interface PreprocessedArgv {
  argv: string[];
  error?: string;
}

/**
 * Read the whole piped stdin as the message text. Undefined without piped
 * input: reading would block on the user's terminal forever. Rejects when
 * stdin never closes — a concurrent process holding the same fd would keep
 * the stream open indefinitely.
 */
export async function readStdinMessage(
  input: Readable & { isTTY?: boolean } = process.stdin,
  timeoutMs: number = STDIN_READ_TIMEOUT_MS,
): Promise<string | undefined> {
  if (input.isTTY) return undefined;
  return new Promise<string>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      input.destroy();
      reject(new Error(`stdin did not close within ${timeoutMs}ms.`));
    }, timeoutMs);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    input.on("data", (chunk) => { text += String(chunk); });
    input.on("end", () => finish(() => resolve(text)));
    input.on("error", (err) => finish(() => reject(err)));
  }).then((text) => {
    // A heredoc adds exactly one trailing newline; keep the rest verbatim.
    return text.replace(/\r?\n$/, "");
  });
}

/**
 * The piped-stdin message for commands that take the text without a `---`
 * separator: non-empty when stdin is a readable pipe carrying content,
 * undefined on a terminal, on blank input, or when the read fails — callers
 * fall back to their own "Message required" error. An unreadable-but-open
 * stdin (the read timeout) reports as no message too, after its wait.
 */
export async function readStdinMessageOrUndefined(
  input: Readable & { isTTY?: boolean } = process.stdin,
  timeoutMs: number = STDIN_READ_TIMEOUT_MS,
): Promise<string | undefined> {
  try {
    const text = await readStdinMessage(input, timeoutMs);
    return text !== undefined && text.trim() !== "" ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Split argv on the first `---` before modality-cli-kit parses it.
 *
 * The kit would otherwise read `---` as an unknown flag and scatter the message
 * tokens across positional slots. Rewriting the tail into one `--message=…`
 * token keeps the text verbatim — including leading dashes and further `---`.
 *
 * With nothing after the separator the message is read from stdin, which lets
 * heredocs and file redirects bypass shell parsing altogether.
 */
export async function preprocessTalkArgv(
  argv: string[],
  stdinTimeoutMs: number = STDIN_READ_TIMEOUT_MS,
): Promise<PreprocessedArgv> {
  if (argv[0] !== TALK_COMMAND_NAME && argv[0] !== TALK_HERO_COMMAND_NAME) return { argv };

  const at = argv.indexOf(MESSAGE_SEPARATOR, 1);
  if (at === -1) return { argv };

  const before = argv.slice(0, at);
  const tokens = argv.slice(at + 1);
  let message = tokens.join(" ");

  if (tokens.length === 0) {
    let stdin: string | undefined;
    try {
      stdin = await readStdinMessage(undefined, stdinTimeoutMs);
    } catch (err) {
      return {
        argv,
        error: `Could not read the message from stdin (${(err as Error).message}). Pipe or redirect the text, or write it after the separator.`,
      };
    }
    if (stdin === undefined) {
      return {
        argv,
        error:
          "Message required after ---: stdin is a terminal. Pipe or redirect the text, or write it after the separator.",
      };
    }
    message = stdin;
  }

  if (message.trim() === "") {
    return { argv, error: "Message required after ---: nothing was supplied." };
  }

  return { argv: [...before, `--message=${message}`] };
}
