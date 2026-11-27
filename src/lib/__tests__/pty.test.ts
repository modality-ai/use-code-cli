import { afterEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { cleanEnv, spawnPty } from "../pty";

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

describe("spawnPty", () => {
  it("rejects fast mode without argv", () => {
    expect(() => spawnPty("ignored", tmpdir(), undefined, { fast: true })).toThrow("non-empty argv");
  });

  it("keeps the shell path as the default", async () => {
    let output = "";
    const proc = spawnPty("echo shell-mode", tmpdir(), (data) => {
      output += new TextDecoder().decode(data);
    });
    await proc.exited;
    expect(output).toContain("shell-mode");
  });

  it("fast mode uses argv without a shell and merges caller env", async () => {
    let output = "";
    const proc = spawnPty("ignored", tmpdir(), (data) => {
      output += new TextDecoder().decode(data);
    }, {
      fast: true,
      argv: ["env"],
      env: { PTY_TEST_MARKER: "marker-value" },
    });
    await proc.exited;
    expect(output).toContain("PTY_TEST_MARKER=marker-value");
    expect(output).not.toContain("-lic");
  });

  it("fast mode keeps caller env but strips CLAUDE* markers", async () => {
    let output = "";
    const proc = spawnPty("ignored", tmpdir(), (data) => {
      output += new TextDecoder().decode(data);
    }, {
      fast: true,
      argv: ["env"],
      env: { CLAUDE_CODE_SESSION_ID: "child", PTY_TEST_MARKER: "marker-value" },
    });
    await proc.exited;
    expect(output).toContain("PTY_TEST_MARKER=marker-value");
    expect(output).not.toContain("CLAUDE_CODE_SESSION_ID");
  });

  it("batches output in order and flushes the last chunk on exit", async () => {
    let output = "";
    const proc = spawnPty("unused", tmpdir(), (data) => {
      output += new TextDecoder().decode(data);
    }, {
      fast: true,
      argv: ["sh", "-c", "for i in $(seq 1 20); do printf '%04d' $i; done"],
    });
    await proc.exited;
    expect(output).toBe(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, "0")).join(""));
  });

  it("batchOutput=false delivers the same output without coalescing", async () => {
    let output = "";
    const proc = spawnPty("unused", tmpdir(), (data) => {
      output += new TextDecoder().decode(data);
    }, {
      fast: true,
      argv: ["sh", "-c", "for i in $(seq 1 20); do printf '%04d' $i; done"],
      batchOutput: false,
    });
    await proc.exited;
    expect(output).toBe(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, "0")).join(""));
  });
});
