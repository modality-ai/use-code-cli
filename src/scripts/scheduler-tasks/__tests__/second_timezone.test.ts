import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as second from "../second";

describe("second timezone", () => {
  it("captures timeZone from 6-star example", async () => {
    await second.scan(join(import.meta.dir, "fixture"));
    const captured = second.modules.find((m) => m.name.endsWith("example.ts"))?.timeZone;
    expect(captured).toBe("Asia/Tokyo");
  });
});
