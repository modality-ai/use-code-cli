import { type CLICommand } from "modality-cli-kit";
import { talkToAll, TalkToAllArgsSchema } from "../../lib/talk-to-all-command";

export const talkToAllCommand: CLICommand = {
  name: "talk-to-all",
  description: "Talk to all active Claude Code sessions",
  inputSchema: TalkToAllArgsSchema,
  execute: (args: any) => talkToAll(args),
};
