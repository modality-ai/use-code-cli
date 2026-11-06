import { describe, expect, it } from "bun:test";
import { cacheFor } from "../static";

describe("cacheFor", () => {
  it("returns no-cache for html files", () => {
    expect(cacheFor("/index.html")).toBe("no-cache");
  });

  it("returns no-cache for root path", () => {
    expect(cacheFor("/")).toBe("no-cache");
  });

  it("returns no-cache for extensionless paths", () => {
    expect(cacheFor("/about")).toBe("no-cache");
    expect(cacheFor("/session/foo")).toBe("no-cache");
  });

  it("returns revalidate for scene assets", () => {
    expect(cacheFor("/static/scene/x.js")).toBe("public, max-age=0, must-revalidate");
  });

  it("returns revalidate for client.js and css", () => {
    expect(cacheFor("/static/client.js")).toBe("public, max-age=0, must-revalidate");
    expect(cacheFor("/styles/style.abc.css")).toBe("public, max-age=0, must-revalidate");
  });

  it("returns 5 minute cache for other assets", () => {
    expect(cacheFor("/img/logo.png")).toBe("public, max-age=300, must-revalidate");
  });
});