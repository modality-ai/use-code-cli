import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import {
  MESSAGE_SEPARATOR,
  preprocessTalkArgv,
  readStdinMessage,
} from "../talk-argv";

describe("readStdinMessage", () => {
  it("reads the full piped message and trims one trailing newline", async () => {
    const stream = Readable.from(["hello ", "long message\n"]);
    expect(await readStdinMessage(stream, 1000)).toBe("hello long message");
  });

  it("fails fast when the piped stdin never closes", async () => {
    const neverEnding = new Readable({ read() {} });
    neverEnding.push("partial message");
    await expect(readStdinMessage(neverEnding, 100)).rejects.toThrow(
      "stdin did not close within 100ms.",
    );
  });
});

describe("preprocessTalkArgv", () => {
  it("joins the --- tail into one verbatim message", async () => {
    const { argv, error } = await preprocessTalkArgv([
      "talk",
      "james",
      MESSAGE_SEPARATOR,
      "line one",
      MESSAGE_SEPARATOR,
      "more",
    ]);
    expect(error).toBeUndefined();
    expect(argv).toEqual(["talk", "james", "--message=line one --- more"]);
  });

  it("reports a held-open stdin as a clear error instead of hanging", async () => {
    const neverEnding = new Readable({ read() {} });
    neverEnding.push("x");
    const originalStdin = process.stdin;
    // readStdinMessage checks the stream's isTTY (process.stdin by default),
    // so the stub must look non-TTY for the read to be attempted at all.
    Object.defineProperty(process, "stdin", {
      value: Object.assign(neverEnding, { isTTY: false }),
      configurable: true,
    });
    try {
      const { error } = await preprocessTalkArgv(["talk", "james", MESSAGE_SEPARATOR], 100);
      expect(error).toContain("Could not read the message from stdin");
      expect(error).toContain("stdin did not close within");
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true,
      });
    }
  });
});
