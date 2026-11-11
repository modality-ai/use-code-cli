import { describe, expect, it } from "bun:test";
import { isCsrfSafe } from "../auth";

describe("isCsrfSafe", () => {
  it("allows requests with no Origin header (non-browser clients)", () => {
    expect(isCsrfSafe(null, "http://127.0.0.1:3000/my/api/session/stop")).toBe(true);
  });

  it("allows same-origin requests", () => {
    expect(isCsrfSafe("http://127.0.0.1:3000", "http://127.0.0.1:3000/my/api/pty/input")).toBe(true);
    expect(isCsrfSafe("https://my-tunnel.example.com", "https://my-tunnel.example.com/my/api/x")).toBe(true);
  });

  it("rejects cross-origin requests", () => {
    expect(isCsrfSafe("https://evil.example.com", "http://127.0.0.1:3000/my/api/session/stop")).toBe(false);
  });

  it("rejects garbage Origin values", () => {
    expect(isCsrfSafe("not a url", "http://127.0.0.1:3000/my/api/x")).toBe(false);
  });
});
