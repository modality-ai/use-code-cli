import { describe, expect, it } from "bun:test";
import { routeSegment } from "../server";

describe("routeSegment", () => {
  it("converts bracketed dir names to colon params", () => {
    expect(routeSegment("[name]")).toBe(":name");
    expect(routeSegment("[id]")).toBe(":id");
  });

  it("leaves normal names unchanged", () => {
    expect(routeSegment("api")).toBe("api");
    expect(routeSegment("sessions")).toBe("sessions");
  });

  it("does not transform partial brackets", () => {
    expect(routeSegment("a[name]")).toBe("a[name]");
    expect(routeSegment("[name")).toBe("[name");
    expect(routeSegment("name]")).toBe("name]");
  });

  it("handles empty brackets", () => {
    expect(routeSegment("[]")).toBe(":");
  });
});