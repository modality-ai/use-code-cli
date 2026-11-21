import { describe, expect, it } from "bun:test";
import * as second from "../second";

describe("second timezone", () => {
  it("captures timeZone from 6-star example", async () => {
    await second.run();
    const captured = second.modules.find((m) => m.name.endsWith("example.ts"))?.timeZone;
    expect(captured).toBe("Asia/Tokyo");
  });
});
