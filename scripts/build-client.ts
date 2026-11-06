import { mkdir } from "node:fs/promises";
import { dirname, relative } from "node:path";

const glob = new Bun.Glob("src/web/**/client.ts");
const entries = [...glob.scanSync(".")];

for (const entry of entries) {
  const rel = relative("src/web", entry); // e.g. "session/[name]/client.ts"
  const outRel = rel.replace(/\.ts$/, ".js"); // "session/[name]/client.js"
  const outPath = "public/dist/" + outRel;
  await mkdir(dirname(outPath), { recursive: true });
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: dirname(outPath),
    target: "browser",
    splitting: true,
    naming: "client.js",
  });
  if (!result.success) {
    for (const m of result.logs) console.error(m);
    process.exit(1);
  }
  console.log("built", entry, "->", outPath);
}
if (entries.length === 0) console.log("no client.ts found");
