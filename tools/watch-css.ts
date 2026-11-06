import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = join(root, "src", "styles", "index.css");

let timer: ReturnType<typeof setTimeout> | null = null;
function rebuild() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    console.log("[watch-css] rebuilding...");
    const p = spawn(process.execPath, ["run", "build:styles"], { cwd: root, stdio: "inherit" });
    p.on("exit", (code) => {
      if (code !== 0) console.error("[watch-css] build failed:", code);
    });
  }, 150);
}

watch(src, () => rebuild());
// also watch directory for new files
watch(join(root, "src", "styles"), () => rebuild());
console.log("[watch-css] watching", src);
// initial build
rebuild();
// keep alive
setInterval(() => {}, 1 << 30);