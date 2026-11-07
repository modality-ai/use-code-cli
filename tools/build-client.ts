// Build browser client bundles for the web layer (Next.js App Router-like).
//
// Client entry points (Phase 3 contract):
//   - primary: a file whose first statement is the `'use client'` directive
//     (co-locate next to page.tsx and import it from there, Next.js style);
//   - transition: legacy auto-discovered client.ts / client.tsx — still built
//     only for route dirs with no 'use client' boundary, deprecated.
//
// All entries build in a single Bun.build (root src/web, splitting) so shared
// deps like React land in a shared chunk. Output preserves the path relative
// to src/web: src/web/sessions/client.ts -> public/dist/sessions/client.js.
// client-manifest.json maps route dir -> entry script URLs for server injection.
// (build-css.ts has its own manifest.json — never clobber it.)

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SRC_ROOT = "src/web";
const OUT_DIR = "public/dist";

// First non-comment statement must be exactly 'use client'.
function hasUseClient(code: string): boolean {
  let rest = code.replace(/^#![^\n]*\n/, "");
  for (;;) {
    const at = rest.search(/\S/);
    if (at < 0) return false;
    rest = rest.slice(at);
    if (rest.startsWith("//")) {
      rest = rest.slice(rest.indexOf("\n") + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end < 0) return false;
      rest = rest.slice(end + 2);
      continue;
    }
    break;
  }
  return /^(['"])use client\1(\s*;)?\s*(\r?\n|$)/.test(rest);
}

const glob = new Bun.Glob(`${SRC_ROOT}/**/*{.ts,.tsx}`);

// Pass 1: collect candidates and the set of route dirs that have a boundary.
const directiveFiles: string[] = [];
const legacyFiles: string[] = [];
for (const file of glob.scanSync(".")) {
  if (file.endsWith(".d.ts")) continue;
  const content = readFileSync(file, "utf8");
  if (hasUseClient(content)) {
    directiveFiles.push(file);
  } else if (/\/client\.tsx?$/.test(file)) {
    legacyFiles.push(file);
  }
}

// Pass 2: a legacy auto-entry builds only when its route dir has no
// 'use client' component; otherwise the directive entry replaces it.
const boundaryDirs = new Set(directiveFiles.map(dirname));
const entries = [...directiveFiles];
const deprecated: string[] = [];
for (const file of legacyFiles) {
  if (boundaryDirs.has(dirname(file))) {
    console.log(
      "skipped legacy auto-entry",
      file,
      "- route dir has 'use client' components; migrate this code there",
    );
    continue;
  }
  deprecated.push(file);
  entries.push(file);
}

if (entries.length === 0) {
  console.log("no client entries found");
  process.exit(0);
}

const result = await Bun.build({
  entrypoints: entries,
  outdir: OUT_DIR,
  root: SRC_ROOT,
  target: "browser",
  splitting: true,
  naming: "[dir]/[name].[ext]",
});
if (!result.success) {
  for (const m of result.logs) console.error(m);
  process.exit(1);
}

// Map route dir -> entry script URLs. Chunk outputs land at dist root and must
// never be injected, so only entry-point outputs inside route dirs are listed.
const manifest: Record<string, string[]> = {};
for (const out of result.outputs) {
  if (out.kind !== "entry-point") continue;
  const rel = relative(OUT_DIR, out.path);
  const dir = dirname(rel);
  if (dir === ".") continue;
  (manifest[dir] ||= []).push("/dist/" + rel);
}
await Bun.write(join(OUT_DIR, "client-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

for (const dir of Object.keys(manifest).sort()) {
  console.log(dir, "->", manifest[dir].join(", "));
}
if (deprecated.length) {
  console.warn(
    "deprecation: legacy auto-entries built without a 'use client' directive:",
    deprecated.join(", "),
    "- mark client entries with 'use client' (legacy discovery is removed in Phase 4)",
  );
}
console.log(`built ${entries.length} client entries -> ${OUT_DIR}/client-manifest.json`);
