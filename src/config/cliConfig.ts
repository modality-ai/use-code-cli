import { z } from "zod";
import { defineCliConfig } from "modality-cli-kit";
import { join } from "node:path";
import { registry, CLI_NAME, TAGLINE } from "../scripts/registry";

/**
 * The one shared CLI config. `createCliRunner` (src/lib/cli-core.ts) and the
 * aiTool's standalone `getHelp` (src/scripts/index.ts) both consume it, so the
 * no-argument help and `--help` render identically (default commands such as
 * `skill`, global options and footer included).
 */
export const cliConfig = defineCliConfig({
  cliName: CLI_NAME,
  tagline: TAGLINE,
  registry,
  globalOptionsSchema: z.object({
    help: z.boolean().optional().describe("Show this help message"),
    json: z.boolean().optional().describe("Output in JSON format"),
  }),
  methodsDir: join(import.meta.dir, "../../methods"),
});
