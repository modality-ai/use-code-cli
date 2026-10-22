import { setupCommandExportValidation } from "modality-cli-kit";

// Every command module must export exactly one item: its `xxxCommand`.
// The command object's `execute` is the single entry point — see the suite
// in modality-cli-kit for the full rationale.
setupCommandExportValidation(import.meta.dir + "/..");
