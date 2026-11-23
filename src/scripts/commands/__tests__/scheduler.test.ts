import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../../../dist/runner/cli.js");

describe("bundled scheduler discovery", () => {
  it("lists second-granularity modules regardless of cwd", async () => {
    const proc = Bun.spawn([process.execPath, CLI, "scheduler", "--json"], {
      cwd: "/tmp",
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const payload = JSON.parse(out);
    expect(payload.data.second.length).toBeGreaterThan(0);
  });
});
