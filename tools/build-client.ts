// Build browser client bundles for the web layer (Next.js App Router-like).
//
// Client entry points:
//   - a file whose first statement is the `'use client'` directive
//     (co-located next to page.tsx, Next.js style). Legacy auto-discovered
//     client.ts / client.tsx entries are no longer supported.
//
// All entries build in a single Bun.build (root src/web, splitting) so shared
// deps like React land in a shared chunk. Output preserves the path relative
// to src/web: src/web/sessions/SessionsApp.client.tsx -> public/dist/sessions/SessionsApp.client.js.
// client-manifest.json maps route dir -> entry script URLs for server injection.
// (build-css.ts has its own manifest.json — never clobber it.)

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

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

const entries: string[] = [];
for (const file of glob.scanSync(".")) {
  if (file.endsWith(".d.ts")) continue;
  const content = readFileSync(file, "utf8");
  if (hasUseClient(content)) entries.push(file);
}

if (entries.length === 0) {
  console.log("no client entries found");
  process.exit(0);
}

// Build-time injection of hydration shim: generate a wrapper per entry that
// re-exports the original module and calls hydrateClient(defaultExport) unless
// `autoHydrate === false` is exported. Wrappers live in a temp staging dir
// mirroring src/web relative paths so output naming/paths are preserved.
const stagingRoot = mkdtempSync(join(tmpdir(), "build-client-"));
const hydrateAbs = resolve(import.meta.dir, "..", "src", "lib", "hydrate.ts");
for (const file of entries) {
  const rel = relative(SRC_ROOT, file);
  const originalAbs = resolve(process.cwd(), file);
  const wrapperPath = join(stagingRoot, rel);
  mkdirSync(dirname(wrapperPath), { recursive: true });
  const wrapper = `export * from ${JSON.stringify(originalAbs)};\n` +
    `import * as __client_mod__ from ${JSON.stringify(originalAbs)};\n` +
    `import { hydrateClient } from ${JSON.stringify(hydrateAbs)};\n` +
    `const __client_default__ = __client_mod__.default;\n` +
    `if (__client_mod__.autoHydrate !== false && __client_default__) {\n` +
    `  hydrateClient(__client_default__);\n` +
    `}\n` +
    `export default __client_default__;\n`;
  writeFileSync(wrapperPath, wrapper);
}

const wrapperEntries = entries.map((f) => join(stagingRoot, relative(SRC_ROOT, f)));

const result = await Bun.build({
  entrypoints: wrapperEntries,
  outdir: OUT_DIR,
  root: stagingRoot,
  target: "browser",
  splitting: true,
  naming: "[dir]/[name].[ext]",
});

if (!result.success) {
  for (const m of result.logs) console.error(m);
  try { rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
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
try { rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
console.log(`built ${entries.length} client entries -> ${OUT_DIR}/client-manifest.json`);
