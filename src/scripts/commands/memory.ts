import { type CLICommand } from "modality-cli-kit";
import { memory, MemoryArgsSchema } from "../../lib/memory-command";

export const memoryCommand: CLICommand = {
  name: "memory",
  aliases: ["memories", "memory-search"],
  description: "List and search memory files across projects",
  inputSchema: MemoryArgsSchema,
  execute: (args: any) => memory(args),
};
