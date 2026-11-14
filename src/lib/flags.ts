import { z } from "zod";
import { SESSION_STATUSES } from "./status";
import { splitFilterTerms } from "./sessions";

/** Flag schemas shared by more than one command. */

const SESSION_STATUS_LIST = SESSION_STATUSES.join(", ");

/** The `--filter-status` flag schema shared by `sessions` and `talk-to-all`. */
export const filterStatusField = z
  .string()
  .refine(
    (v) => splitFilterTerms(v).every((t) => SESSION_STATUSES.some((s) => s === t)),
    `must be ${SESSION_STATUS_LIST}, or a comma-separated list of them`,
  )
  .optional()
  .describe(`Only sessions in any of these statuses: ${SESSION_STATUS_LIST} (comma-separated)`);
