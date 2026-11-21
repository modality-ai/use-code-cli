import { type CLICommand } from "modality-cli-kit";
import { talkHero, TalkHeroArgsSchema } from "../../lib/talk-hero-command";

export const talkHeroCommand: CLICommand = {
  name: "talk-hero",
  positionalKeys: ["hero", "message"],
  description: "Talk to the first active session in this project whose deployed hero matches a keyword",
  inputSchema: TalkHeroArgsSchema,
  execute: (args: any) => talkHero(args),
};
