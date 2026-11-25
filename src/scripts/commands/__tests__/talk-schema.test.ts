import { describe, expect, it } from "bun:test";
import { talkCommand } from "../talk";

describe("TalkArgsSchema", () => {
  it("accepts a basic talk payload", () => {
    const parsed = talkCommand.inputSchema.parse({ target: "s1", message: "hi" });
    expect(parsed.target).toBe("s1");
    expect(parsed.message).toBe("hi");
  });

  it("accepts an optional image path", () => {
    const parsed = talkCommand.inputSchema.parse({
      target: "s1",
      message: "hi",
      image: "/tmp/.use-code-cli/uploads/x.png",
    });
    expect(parsed.image).toBe("/tmp/.use-code-cli/uploads/x.png");
  });
});
