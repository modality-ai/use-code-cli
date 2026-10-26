import { z } from "zod";
import { SESSION_STATUSES, splitFilterTerms } from "./sessions";

/** Flag schemas shared by more than one command. */

/** The `--filter-status` flag schema shared by `sessions` and `talk-to-all`. */
export const filterStatusField = z
  .string()
  .refine(
    (v) => splitFilterTerms(v).every((t) => SESSION_STATUSES.some((s) => s === t)),
    `must be "busy", "idle", or a comma-separated list of them`,
  )
  .optional()
  .describe("Only sessions in any of these statuses: busy, idle (comma-separated)");
