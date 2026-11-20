import { type CLICommand } from "modality-cli-kit";
import { talk, TalkArgsSchema } from "../../lib/talk-command";

export const talkCommand: CLICommand = {
  name: "talk",
  description: "Talk to an active Claude Code session (auto-picks the only one)",
  inputSchema: TalkArgsSchema,
  usage: [
    'use-code-cli talk [target] "message" [--one-way] [--in-reply-to <msg_id>]',
    'use-code-cli talk [target] [flags] --- message text (literal; stdin if empty)',
  ],
  positionalKeys: ["target", "message"],
  execute: (args: any) => talk(args),
  examples: [
    'use-code-cli talk "run the tests and report"',
    'use-code-cli talk use-stock-3a --one-way --- exactly this text, --one-way and all',
    'use-code-cli talk use-stock-3a --- < message.txt',
    'use-code-cli talk use-stock-3a "done" --in-reply-to 1f0c… --one-way',
  ],
};

// Re-exports removed to satisfy command-module export contract.
