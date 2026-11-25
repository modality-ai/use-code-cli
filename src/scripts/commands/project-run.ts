import type { CLICommand } from "modality-cli-kit";
import { ProjectRunArgsSchema, runProjectCommand } from "../../lib/project-run";

export const projectRunCommand: CLICommand = {
  name: "project-run",
  aliases: ["project-exec", "run-project"],
  description: "Run a shell command in a resolved project's working directory",
  inputSchema: ProjectRunArgsSchema,
  positionalKeys: ["target"],
  execute: runProjectCommand,
  examples: [
    "use-code-cli project-run /w/proj -- ls -la",
    "use-code-cli project-run --project /w/proj -- echo hello",
    "use-code-cli project-run /w/proj \"echo hello\"",
  ],
};
