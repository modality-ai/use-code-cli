import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

// Build the client bundle once on startup (Next.js-like: client module is compiled, not transpiled on demand)
const build = spawn(process.execPath, ["run", "build:client"], { cwd: root, stdio: "inherit" });
build.on("exit", (code) => { if (code !== 0 && code !== null) console.error("build:client exited", code); });

const css = spawn(process.execPath, ["tools/watch-css.ts"], { cwd: root, stdio: "inherit" });
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