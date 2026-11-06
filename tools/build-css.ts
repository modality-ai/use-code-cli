import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = join(root, "src", "styles", "index.css");
const outDir = join(root, "public", "dist");
const tmp = join(outDir, "tailwind.css");

mkdirSync(outDir, { recursive: true });

const res = spawnSync(
  process.execPath,
  ["node_modules/@tailwindcss/cli/dist/index.mjs", "-i", src, "-o", tmp, "--minify"],
  { stdio: "inherit", cwd: root },
);
if (res.status !== 0) process.exit(res.status ?? 1);

const css = readFileSync(tmp);
const hash = createHash("sha256").update(css).digest("hex").slice(0, 8);
const hashedName = `style.${hash}.css`;
const hashed = join(outDir, hashedName);
writeFileSync(hashed, css);
rmSync(tmp, { force: true });

for (const f of readdirSync(outDir)) {
  if (/^style\.[0-9a-f]{8}\.css$/.test(f) && f !== hashedName) {
    rmSync(join(outDir, f), { force: true });
  }
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ style: `/dist/${hashedName}` }));
console.log(`Built ${hashed}`);