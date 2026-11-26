import { describe, expect, it } from "bun:test";
import { talkToAllCommand } from "../talk-to-all";

describe("talkToAllCommand", () => {
  it("accepts the message as a positional CLI argument", () => {
    expect(talkToAllCommand.positionalKeys).toEqual(["message"]);
  });
});
