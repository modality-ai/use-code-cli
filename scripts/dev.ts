import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const css = spawn(process.execPath, ["scripts/watch-css.ts"], { cwd: root, stdio: "inherit" });
const server = spawn(process.execPath, ["--hot", "src/runner/server.ts"], { cwd: root, stdio: "inherit", env: { ...process.env, PORT: process.env.PORT || "3000" } });

function cleanup() {
  css.kill();
  server.kill();
  process.exit();
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

css.on("exit", (code) => { if (code !== 0 && code !== null) console.error("watch-css exited", code); });
server.on("exit", (code) => { cleanup(); });