import { describe, expect, it } from "bun:test";
import {
  tunnelPortFromEnv,
  extractTunnelUrl,
  reconnectDelay,
  getTunnelStatus,
  getSession,
} from "../tunnel";

describe("tunnelPortFromEnv", () => {
  it("returns 3000 when undefined", () => {
    expect(tunnelPortFromEnv(undefined)).toBe("3000");
  });

  it("returns 3000 when empty string", () => {
    expect(tunnelPortFromEnv("")).toBe("3000");
  });

  it("returns the port for a valid number", () => {
    expect(tunnelPortFromEnv("8080")).toBe("8080");
  });

  it("returns 3000 for non-numeric input", () => {
    expect(tunnelPortFromEnv("abc")).toBe("3000");
  });

  it("returns 3000 for out-of-range (0)", () => {
    expect(tunnelPortFromEnv("0")).toBe("3000");
  });

  it("returns 3000 for out-of-range (65536)", () => {
    expect(tunnelPortFromEnv("65536")).toBe("3000");
  });

  it("accepts boundary 65535", () => {
    expect(tunnelPortFromEnv("65535")).toBe("65535");
  });

  it("accepts boundary 1", () => {
    expect(tunnelPortFromEnv("1")).toBe("1");
  });
});

describe("extractTunnelUrl", () => {
  it("returns null when no url present", () => {
    expect(extractTunnelUrl("hello world")).toBeNull();
  });

  it("extracts a trycloudflare url", () => {
    const chunk = "your url is https://abc-123.trycloudflare.com/path";
    expect(extractTunnelUrl(chunk)).toBe("https://abc-123.trycloudflare.com");
  });

  it("is case-insensitive", () => {
    expect(extractTunnelUrl("HTTPS://ABC.trycloudflare.com")).toBe("HTTPS://ABC.trycloudflare.com");
  });

  it("returns null for other hosts", () => {
    expect(extractTunnelUrl("https://example.com/x")).toBeNull();
  });

  it("returns first match", () => {
    const chunk = "https://a.trycloudflare.com and https://b.trycloudflare.com";
    expect(extractTunnelUrl(chunk)).toBe("https://a.trycloudflare.com");
  });
});

describe("reconnectDelay", () => {
  it("attempt 1 → 1000ms", () => {
    expect(reconnectDelay(1)).toBe(1000);
  });

  it("attempt 2 → 2000ms", () => {
    expect(reconnectDelay(2)).toBe(2000);
  });

  it("attempt 3 → 4000ms", () => {
    expect(reconnectDelay(3)).toBe(4000);
  });

  it("caps at 30000ms", () => {
    expect(reconnectDelay(10)).toBe(30000);
  });

  it("attempt 5 → 16000ms", () => {
    expect(reconnectDelay(5)).toBe(16000);
  });
});

describe("getTunnelStatus", () => {
  it("returns an object with tunnelUrl, autoReconnectEnabled, isTunnelAlive", () => {
    const s = getTunnelStatus();
    expect(s).toHaveProperty("tunnelUrl");
    expect(s).toHaveProperty("autoReconnectEnabled");
    expect(s).toHaveProperty("isTunnelAlive");
  });
});

describe("getSession", () => {
  it("returns undefined for unknown id", () => {
    expect(getSession("does-not-exist")).toBeUndefined();
  });
});