import { createCliRunner } from "modality-cli-kit";
import { aiTool } from "../scripts";
import { cliConfig } from "../config/cliConfig";

/**
 * The use-code-cli CLI. All the generic machinery (help, alias resolution, arg
 * validation, dispatch) lives in `modality-cli-kit`; this file only wires the
 * shared config (src/config/cliConfig.ts) to the runner. Passing `aiTool`
 * routes command dispatch through the same counter-script entry point the MCP
 * server uses, and makes an empty invocation defer to it (no-command → help
 * text, built from the same config so it matches `--help`).
 */
export const cli = createCliRunner({ ...cliConfig, aiTool });

export const runCli = cli.run;
