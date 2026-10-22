import { createCommandRegistry } from "modality-cli-kit";
import { commands } from "./generated.commands";

/** The CLI binary name, shown in help usage lines. */
export const CLI_NAME = "use-code-cli";

/** The one-line tagline for the CLI, shown at the top of help. */
export const TAGLINE = "use-code-cli command-line toolkit";

/**
 * The command registry, built from a generated static commands index.
 *
 * There is no hand-written index to maintain: `build:commands` scans the
 * commands directory (src/scripts/commands by default) and writes
 * `generated.commands.ts`, which statically imports every command here.
 * Adding a command is dropping in a file and re-running the build; removing
 * one is deleting that file.
 *
 * Aliases live on each command's own `aliases` field and are harvested
 * automatically by `createCommandRegistry` — nothing else needs editing.
 *
 * A static list (rather than a runtime directory scan) means the bundler emits
 * one shared dependency graph — the built CLI starts in milliseconds instead
 * of importing every command as a separate bundle on each launch.
 */
export const registry = createCommandRegistry(commands);
