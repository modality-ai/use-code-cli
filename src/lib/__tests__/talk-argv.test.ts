import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import {
  MESSAGE_SEPARATOR,
  preprocessTalkArgv,
  readStdinMessage,
  readStdinMessageOrUndefined,
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

describe("readStdinMessageOrUndefined", () => {
  it("returns the piped text with the trailing newline trimmed", async () => {
    const stream = Readable.from(["line one\nline ", "two\n"]);
    expect(await readStdinMessageOrUndefined(stream, 1000)).toBe("line one\nline two");
  });

  it("reports a terminal as no message", async () => {
    const tty = Object.assign(new Readable({ read() {} }), { isTTY: true });
    expect(await readStdinMessageOrUndefined(tty, 100)).toBeUndefined();
  });

  it("reports blank input as no message", async () => {
    expect(await readStdinMessageOrUndefined(Readable.from(["  \n"]), 1000)).toBeUndefined();
  });

  it("reports a held-open stdin as no message instead of hanging forever", async () => {
    const neverEnding = new Readable({ read() {} });
    neverEnding.push("x");
    expect(await readStdinMessageOrUndefined(neverEnding, 50)).toBeUndefined();
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

  it("preprocesses talk-to-all messages after --- like talk", async () => {
    const { argv, error } = await preprocessTalkArgv([
      "talk-to-all",
      MESSAGE_SEPARATOR,
      "ship",
      MESSAGE_SEPARATOR,
      "it",
    ]);
    expect({ argv, error }).toEqual({
      argv: ["talk-to-all", "--message=ship --- it"],
      error: undefined,
    });
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
