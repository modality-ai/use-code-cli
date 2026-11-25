import { preprocessProjectRunArgv } from "./project-run-argv";
import { preprocessTalkArgv } from "./talk-argv";

export interface NormalizedArgv {
  argv: string[];
  error?: string;
}

/**
 * Rewrite raw argv before the kit's flag parser. Shared by the production
 * entrypoint and in-process CLI tests so both exercise the real preprocessors.
 */
export async function normalizeCliArgv(argv: string[]): Promise<NormalizedArgv> {
  let normalized = argv;

  if (normalized[0] === "project" && normalized[1] === "run") {
    normalized = ["project-run", ...normalized.slice(2)];
  }
  if (normalized[0] === "project" && normalized[1] === "ps") {
    normalized = ["project-ps", ...normalized.slice(2)];
  }

  normalized = preprocessProjectRunArgv(normalized).argv;
  const { argv: normalized2, error } = await preprocessTalkArgv(normalized);
  return { argv: normalized2, error };
}
