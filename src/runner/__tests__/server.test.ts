import { describe, expect, it } from "bun:test";
import { pageTitle, routeSegment } from "../server";

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

describe("pageTitle", () => {
  it("uses the app name for the root route", () => {
    expect(pageTitle("/")).toBe("use-code-cli");
  });

  it("substitutes dynamic params into the route", () => {
    expect(pageTitle("/session/:name", { name: "use-code-cli-4e" })).toBe("session/use-code-cli-4e");
  });

  it("keeps the placeholder when a param is missing", () => {
    expect(pageTitle("/session/:name")).toBe("session/:name");
  });

  it("passes static routes through unchanged", () => {
    expect(pageTitle("/help")).toBe("help");
    expect(pageTitle("/tunnel")).toBe("tunnel");
  });
});