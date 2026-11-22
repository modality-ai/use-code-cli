import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { spawn } from "node:child_process";
import { resolveServerEntry } from "../../lib/server-entry";

const StartArgsSchema = z.object({
  port: z
    .coerce.number()
    .optional()
    .describe("Port to listen on (default: 3000, or PORT env)"),
  host: z
    .string()
    .optional()
    .describe("Host to bind (default: 127.0.0.1)"),
  "include-offline": z
    .boolean()
    .optional()
    .describe("Include offline sessions"),
});

type StartArgs = z.infer<typeof StartArgsSchema>;

async function startCommandExecute(args: StartArgs) {
  const port = args.port ?? Number(process.env.PORT ?? 3000);
  const host = args.host ?? process.env.HOST ?? "127.0.0.1";
  const serverPath = resolveServerEntry(import.meta.url);

  const child = spawn(process.execPath, [serverPath], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HOST: host },
  });

  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
}

export const startCommand: CLICommand = {
  name: "start",
  description: "Start the use-code-cli web server.",
  inputSchema: StartArgsSchema,
  execute: startCommandExecute,
  examples: ["use-code-cli start", "use-code-cli start --port 8080"],
};