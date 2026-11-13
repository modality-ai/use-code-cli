import { describe, expect, it } from "bun:test";
import { hasReturnedToIdle } from "../pause/route";

describe("hasReturnedToIdle", () => {
  it("returns true when the session is gone or offline", () => {
    expect(hasReturnedToIdle(null)).toBe(true);
    expect(hasReturnedToIdle({ online: false, status: "busy" })).toBe(true);
  });

  it("returns false while the session is still working", () => {
    expect(hasReturnedToIdle({ online: true, status: "busy" })).toBe(false);
    expect(hasReturnedToIdle({ online: true, status: "active" })).toBe(false);
  });

  it("returns true once the session is idle or in shell", () => {
    expect(hasReturnedToIdle({ online: true, status: "idle" })).toBe(true);
    expect(hasReturnedToIdle({ online: true, status: "shell" })).toBe(true);
    expect(hasReturnedToIdle({ online: true, status: null })).toBe(true);
  });
});
