import { afterEach, describe, expect, it } from "bun:test";
import { cleanEnv } from "../pty";

describe("cleanEnv", () => {
  const saved: Record<string, string | undefined> = {};
  const tracked = ["FOO", "CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE", "TERM"];

  afterEach(() => {
    for (const k of tracked) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("strips CLAUDE* env vars and forces TERM=xterm-256color", () => {
    for (const k of tracked) saved[k] = process.env[k];
    process.env.FOO = "bar";
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    process.env.CLAUDECODE = "1";
    delete process.env.TERM;

    const env = cleanEnv();
    expect(env.FOO).toBe("bar");
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.TERM).toBe("xterm-256color");
  });
});
