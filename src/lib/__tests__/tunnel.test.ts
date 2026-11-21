import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractTunnelUrl,
  redactTunnelUrl,
  getTunnelStatus,
  getSession,
  readPersistedState,
  writePersistedState,
  prunePersistedUrl,
  isRecentlyAlive,
  shouldReplacePersistedUrl,
  isCloudflaredSpawnSignature,
  recoverPersistedUrl,
  stopTunnel,
} from "../tunnel";

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

describe("redactTunnelUrl", () => {
  it("makes a diagnostic quoting tunnel URLs non-extractable (a stale URL must not resurrect tunnel.json)", () => {
    // A real diagnostic line quoting two URLs — every occurrence must be
    // mangled while the subdomain stays readable for debugging.
    const line = "not replacing persisted URL https://old.trycloudflare.com with https://new.trycloudflare.com: lastAliveAt still inside the grace window (HTTPS://UPPER.TRYCLOUDFLARE.COM)";
    const redacted = redactTunnelUrl(line);
    expect(extractTunnelUrl(redacted)).toBeNull();
    expect(redacted).toContain("old.trycloudflare<redacted>");
  });
});

describe("isCloudflaredSpawnSignature", () => {
  it("matches a cloudflared process targeting a loopback URL", () => {
    expect(isCloudflaredSpawnSignature("cloudflared tunnel --url http://127.0.0.1:59998")).toBe(true);
  });
  it("rejects a decoy whose target is remote (the sweep kills only loopback tunnels)", () => {
    expect(isCloudflaredSpawnSignature("cloudflared tunnel --url https://elsewhere.example.com")).toBe(false);
  });
  it("rejects a line without the cloudflared binary name", () => {
    expect(isCloudflaredSpawnSignature("sleep 300")).toBe(false);
  });
});

describe("getTunnelStatus", () => {
  it("returns an object with tunnelUrl, autoReconnectEnabled, isTunnelAlive", () => {
    const s = getTunnelStatus();
    expect(s).toHaveProperty("tunnelUrl");
    expect(s).toHaveProperty("autoReconnectEnabled");
    expect(s).toHaveProperty("isTunnelAlive");
  });

  it("hides lastAliveAt when no tunnel URL is running (stale persisted marker must not read as current)", () => {
    const origHome = process.env.HOME;
    const tmpHome = mkdtempSync(join(tmpdir(), "use-code-cli-status-"));
    process.env.HOME = tmpHome;
    try {
      writePersistedState({ url: "https://x.trycloudflare.com", active: true, lastAliveAt: new Date().toISOString() });
      // nobody running; it must not read as current liveness.
      expect(getTunnelStatus().lastAliveAt).toBeNull();
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe("getSession", () => {
  it("returns undefined for unknown id", () => {
    expect(getSession("does-not-exist")).toBeUndefined();
  });
});

describe("shouldReplacePersistedUrl", () => {
  const NEW = "https://new.trycloudflare.com";
  const OLD = "https://old.trycloudflare.com";
  const state = (url: string | null, lastAliveAt?: string) => ({ url, lastAliveAt });

  it("replaces when no state exists", () => {
    expect(shouldReplacePersistedUrl(null, NEW)).toBe(true);
  });

  it("replaces when the persisted url is null", () => {
    expect(shouldReplacePersistedUrl(state(null), NEW)).toBe(true);
  });

  it("replaces the same url so its marker can be refreshed", () => {
    expect(shouldReplacePersistedUrl(state(NEW, new Date().toISOString()), NEW)).toBe(true);
  });

  it("keeps a different url whose liveness marker is still fresh", () => {
    expect(shouldReplacePersistedUrl(state(OLD, new Date().toISOString()), NEW)).toBe(false);
  });

  it("replaces a different url once its marker times out", () => {
    expect(shouldReplacePersistedUrl(state(OLD, new Date(Date.now() - 120_000).toISOString()), NEW)).toBe(true);
  });

  it("replaces a different url with no liveness marker", () => {
    expect(shouldReplacePersistedUrl(state(OLD, undefined), NEW)).toBe(true);
  });
});

describe("isRecentlyAlive", () => {
  it("is true for a timestamp inside the grace window", () => {
    expect(isRecentlyAlive(new Date(Date.now() - 10_000).toISOString())).toBe(true);
  });

  it("is false for a timestamp older than the grace window", () => {
    expect(isRecentlyAlive(new Date(Date.now() - 120_000).toISOString())).toBe(false);
  });

  it("is false for undefined or invalid timestamps", () => {
    expect(isRecentlyAlive(undefined)).toBe(false);
    expect(isRecentlyAlive("not a date")).toBe(false);
  });

  it("honours a custom grace window", () => {
    expect(isRecentlyAlive(new Date(Date.now() - 5_000).toISOString(), 1_000)).toBe(false);
  });
});

describe("readPersistedState / writePersistedState", () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), "use-code-cli-tunnel-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns null when no persisted file exists", () => {
    expect(readPersistedState()).toBeNull();
  });

  it("round-trips a persisted state", () => {
    const state = { url: "https://x.trycloudflare.com", active: true, autoReconnect: true, port: "3000", lastAliveAt: "2026-01-01T00:00:00.000Z" };
    writePersistedState(state);
    expect(readPersistedState()).toEqual(state);
  });

  it("returns null for malformed JSON", () => {
    mkdirSync(join(tmpHome, ".use-code-cli"), { recursive: true });
    writeFileSync(join(tmpHome, ".use-code-cli", "tunnel.json"), "{not json", "utf8");
    expect(readPersistedState()).toBeNull();
  });

  it("returns null for a non-object value", () => {
    mkdirSync(join(tmpHome, ".use-code-cli"), { recursive: true });
    writeFileSync(join(tmpHome, ".use-code-cli", "tunnel.json"), JSON.stringify("just a string"), "utf8");
    expect(readPersistedState()).toBeNull();
  });

  it("normalizes missing/invalid fields to undefined or null", () => {
    mkdirSync(join(tmpHome, ".use-code-cli"), { recursive: true });
    writeFileSync(join(tmpHome, ".use-code-cli", "tunnel.json"), JSON.stringify({ url: 42, autoReconnect: "yes", active: 1 }), "utf8");
    expect(readPersistedState()).toEqual({
      url: null,
      autoReconnect: undefined,
      active: undefined,
      port: undefined,
      lastAliveAt: undefined,
    });
  });

  it("keeps recently-alive state when the liveness probe fails", async () => {
    writePersistedState({ url: "https://x.trycloudflare.com", active: true, lastAliveAt: new Date().toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("down"); }) as any;
    try {
      expect(await prunePersistedUrl()).toBe(false);
      expect(readPersistedState()?.url).toBe("https://x.trycloudflare.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("removes state when the liveness marker is stale", async () => {
    writePersistedState({ url: "https://x.trycloudflare.com", active: true, lastAliveAt: new Date(Date.now() - 120_000).toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("down"); }) as any;
    try {
      expect(await prunePersistedUrl()).toBe(true);
      expect(readPersistedState()).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps state when the endpoint answers with an origin error behind a live tunnel (502)", async () => {
    writePersistedState({ url: "https://x.trycloudflare.com", active: true, lastAliveAt: new Date(Date.now() - 120_000).toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 502 })) as any;
    try {
      expect(await prunePersistedUrl()).toBe(false);
      expect(readPersistedState()?.url).toBe("https://x.trycloudflare.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("removes state when Cloudflare edge reports the tunnel is unreachable (530)", async () => {
    writePersistedState({ url: "https://x.trycloudflare.com", active: true, lastAliveAt: new Date(Date.now() - 120_000).toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 530 })) as any;
    try {
      expect(await prunePersistedUrl()).toBe(true);
      expect(readPersistedState()).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("removes state with a non-trycloudflare URL without probing it", async () => {
    writePersistedState({ url: "https://evil.example.com", active: true, lastAliveAt: new Date().toISOString() });
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => { fetched = true; return { ok: true, status: 200 }; }) as any;
    try {
      expect(await prunePersistedUrl()).toBe(true);
      expect(readPersistedState()).toBeNull();
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("serializes concurrent prunes without deadlock", async () => {
    writePersistedState({ url: "https://x.trycloudflare.com", active: true, lastAliveAt: new Date(Date.now() - 120_000).toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("down"); }) as any;
    try {
      const results = await Promise.all([prunePersistedUrl(), prunePersistedUrl(), prunePersistedUrl()]);
      expect(results).toEqual([true, true, true]);
      expect(readPersistedState()).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("recoverPersistedUrl", () => {
  let originalHome: string | undefined;
  let tmpHome: string;
  const TUNNEL_URL = "https://live.trycloudflare.com";

  /** Run `fn` with a stubbed global fetch, restoring it afterwards. */
  async function withFetch(impl: any, fn: () => Promise<void>) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = impl;
    try { await fn(); } finally { globalThis.fetch = originalFetch; }
  }

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), "use-code-cli-tunnel-"));
    process.env.HOME = tmpHome;
    // Reset module state (tunnelUrl, manualStop): other test files exercise the
    // tunnel route with the real $HOME and can leave a live URL in memory,
    // which would make recoverPersistedUrl() short-circuit before our fixture.
    // Awaited: a stop whose locked removal lands after HOME is restored would
    // delete the REAL tunnel.json instead of this fixture's.
    await stopTunnel();
  });

  afterEach(async () => {
    // Reset module state (tunnelUrl, manualStop) so tests stay independent.
    // Awaited while HOME still points at the fixture — the removal must not
    // outlive it.
    await stopTunnel();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("keeps a recently-alive tunnel but clears a stale one when the probe fails", async () => {
    await withFetch((async () => { throw new Error("down"); }), async () => {
      writePersistedState({ url: TUNNEL_URL, active: true, lastAliveAt: new Date().toISOString() });
      expect(await recoverPersistedUrl()).toBeNull();
      expect(readPersistedState()?.url).toBe(TUNNEL_URL);

      writePersistedState({ url: TUNNEL_URL, active: true, lastAliveAt: new Date(Date.now() - 120_000).toISOString() });
      expect(await recoverPersistedUrl()).toBeNull();
      expect(readPersistedState()).toBeNull();
    });
  });

  it("adopts a still-served persisted URL", async () => {
    await withFetch((async () => ({ ok: true, status: 200 })), async () => {
      writePersistedState({ url: TUNNEL_URL, active: true, autoReconnect: true, lastAliveAt: "2026-01-01T00:00:00.000Z" });
      expect(await recoverPersistedUrl()).toBe(TUNNEL_URL);
      expect(getTunnelStatus().autoReconnectEnabled).toBe(true);
      expect(readPersistedState()?.url).toBe(TUNNEL_URL);
    });
  });

  it("adopts a persisted URL whose endpoint answers with an origin error (502)", async () => {
    await withFetch((async () => ({ ok: false, status: 502 })), async () => {
      writePersistedState({ url: TUNNEL_URL, active: true, autoReconnect: true, lastAliveAt: "2026-01-01T00:00:00.000Z" });
      expect(await recoverPersistedUrl()).toBe(TUNNEL_URL);
    });
  });

  it("refreshes the liveness marker when the tunnel URL still answers", async () => {
    await withFetch((async () => ({ ok: true, status: 200 })), async () => {
      writePersistedState({ url: TUNNEL_URL, active: true, lastAliveAt: "2026-01-01T00:00:00.000Z" });
      expect(await prunePersistedUrl()).toBe(false);
      expect(readPersistedState()?.url).toBe(TUNNEL_URL);
      expect(readPersistedState()?.lastAliveAt).not.toBe("2026-01-01T00:00:00.000Z");
    });
  });
});
