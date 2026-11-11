import { describe, expect, it } from "bun:test";
import { cacheFor, shouldSkipStatic } from "../static";

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
    expect(cacheFor("/dist/session/[name]/client.js")).toBe("public, max-age=0, must-revalidate");
    expect(cacheFor("/dist/style.abc.css")).toBe("public, max-age=0, must-revalidate");
  });

  it("returns 5 minute cache for other assets", () => {
    expect(cacheFor("/img/logo.png")).toBe("public, max-age=300, must-revalidate");
  });
});
describe("shouldSkipStatic", () => {
  it("skips extensionless paths", () => {
    expect(shouldSkipStatic("/about")).toBe(true);
    expect(shouldSkipStatic("/")).toBe(true);
    expect(shouldSkipStatic("/session/foo")).toBe(true);
  });

  it("skips session routes even with dots", () => {
    expect(shouldSkipStatic("/session/foo.js")).toBe(true);
    expect(shouldSkipStatic("/sessions")).toBe(true);
    expect(shouldSkipStatic("/sessions/x")).toBe(true);
  });

  it("skips my/* routes", () => {
    expect(shouldSkipStatic("/my/session/foo")).toBe(true);
    expect(shouldSkipStatic("/my/sessions")).toBe(true);
    expect(shouldSkipStatic("/my/sessions/x")).toBe(true);
    expect(shouldSkipStatic("/my/tunnel")).toBe(true);
    expect(shouldSkipStatic("/my/tunnel/x")).toBe(true);
  });

  it("skips projects routes even with dots", () => {
    expect(shouldSkipStatic("/my/projects")).toBe(true);
    expect(shouldSkipStatic("/my/projects/x")).toBe(true);
    expect(shouldSkipStatic("/my/project/foo")).toBe(true);
    expect(shouldSkipStatic("/my/project/foo/exec")).toBe(true);
  });

  it("does not skip static assets with extensions", () => {
    expect(shouldSkipStatic("/index.html")).toBe(false);
    expect(shouldSkipStatic("/img/logo.png")).toBe(false);
    expect(shouldSkipStatic("/dist/style.abc.css")).toBe(false);
    expect(shouldSkipStatic("/static/scene/x.js")).toBe(false);
  });
});
