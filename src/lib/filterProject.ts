/** Shared helpers for the `--filter-project` flag used by sessions, monitors, memory, etc. */

import { basename } from "node:path";

/** Split a `--filter-project` value into normalized, lowercased terms. */
export function splitFilterProjectTerms(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.includes("/") || t.includes("\\") ? basename(t) : t))
    .map((t) => t.toLowerCase());
}

/** Whether any of the given paths' basenames matches any of the terms. */
export function matchesProjectFolder(
  paths: (string | undefined)[],
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const folders = paths
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => basename(p).toLowerCase());
  return terms.some((term) => folders.some((folder) => folder.includes(term)));
}

/** Filter an array by a `--filter-project` value, using a path accessor. */
export function filterByProject<T>(
  items: T[],
  getPaths: (item: T) => (string | undefined)[],
  filterProject: string | undefined,
): T[] {
  const terms = splitFilterProjectTerms(filterProject);
  if (terms.length === 0) return items;
  return items.filter((item) => matchesProjectFolder(getPaths(item), terms));
}
