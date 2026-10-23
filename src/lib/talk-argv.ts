/** The command this preprocessor applies to. */
export const TALK_COMMAND_NAME = "talk";

/** The token that ends the CLI arguments and starts the literal message. */
export const MESSAGE_SEPARATOR = "---";

export interface PreprocessedArgv {
  argv: string[];
  error?: string;
}

async function readStdinMessage(): Promise<string | undefined> {
  // No piped input: reading would block on the user's terminal forever.
  if (process.stdin.isTTY) return undefined;
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  // A heredoc adds exactly one trailing newline; keep the rest verbatim.
  return text.replace(/\r?\n$/, "");
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
export async function preprocessTalkArgv(argv: string[]): Promise<PreprocessedArgv> {
  if (argv[0] !== TALK_COMMAND_NAME) return { argv };

  const at = argv.indexOf(MESSAGE_SEPARATOR, 1);
  if (at === -1) return { argv };

  const before = argv.slice(0, at);
  const tokens = argv.slice(at + 1);
  let message = tokens.join(" ");

  if (tokens.length === 0) {
    const stdin = await readStdinMessage();
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
