import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveServerPath(base: string, exists: (p: string) => boolean = existsSync): string {
  const jsPath = join(base, "runner", "server.js");
  const tsPath = join(base, "runner", "server.ts");
  return exists(jsPath) ? jsPath : tsPath;
}

// The CLI runs from src/scripts/commands, dist/scripts/commands, or the dist/runner bundle; detect the base instead of assuming depth.
export function resolveServerEntry(moduleUrl: string, exists: (p: string) => boolean = existsSync): string {
  const sourceBase = fileURLToPath(new URL("../../", moduleUrl));
  const bases = [fileURLToPath(new URL("../", moduleUrl)), sourceBase];
  const hasServer = (candidate: string) =>
    exists(join(candidate, "runner", "server.js")) || exists(join(candidate, "runner", "server.ts"));
  const base = bases.find(hasServer) ?? sourceBase;
  return resolveServerPath(base, exists);
}
