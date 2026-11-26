import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "../route";
import { registerLocalServer, stopTunnel } from "../../../../../lib/tunnel";

// Keep the two-probe retry deterministic and fast in route tests.
const ORIGINAL_PROBE_DELAY = process.env.TUNNEL_PROBE_DELAY_MS;
process.env.TUNNEL_PROBE_DELAY_MS = "0";
afterAll(() => {
  if (ORIGINAL_PROBE_DELAY === undefined) delete process.env.TUNNEL_PROBE_DELAY_MS;
  else process.env.TUNNEL_PROBE_DELAY_MS = ORIGINAL_PROBE_DELAY;
});

// HOME fixture: the tunnel lib resolves $HOME per call, so a temp home keeps
// this test's tunnel.json reads and writes off the real state dir (shared
// with dev servers and other test files).
let originalHome: string | undefined;
let originalBin: string | undefined;
let tmpHome: string;

beforeEach(async () => {
  originalHome = process.env.HOME;
  originalBin = process.env.CLOUDFLARED_BIN;
  tmpHome = mkdtempSync(join(tmpdir(), "use-code-cli-route-"));
  process.env.HOME = tmpHome;
  // checkCloudflared spawns its binary to report a version; a nonexistent bin
  // keeps that out of the test without depending on what is installed here.
  process.env.CLOUDFLARED_BIN = "/nonexistent-cloudflared-for-tests";
  registerLocalServer({ hostname: "127.0.0.1", port: 3000 });
  // Reset module state (tunnelUrl, manualStop): another test file exercising
  // the tunnel lib with the real $HOME can leave a live URL in memory, which
  // would leak into this GET. Awaited while HOME still points at the fixture —
  // a stop's locked removal must not land after HOME is restored.
  await stopTunnel();
});

afterEach(async () => {
  await stopTunnel();
  registerLocalServer(null);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalBin === undefined) delete process.env.CLOUDFLARED_BIN;
  else process.env.CLOUDFLARED_BIN = originalBin;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("GET /my/api/tunnel", () => {
  it("passes getTunnelStatus()'s guarded lastAliveAt through — a fresh persisted marker with no running tunnel reads as null", async () => {
    // Composite regression for the route's lastAliveAt passthrough: wiring
    // the raw persisted marker instead of the guarded status would report
    // liveness for a tunnel nothing runs — the exact bug the getTunnelStatus
    // guard exists to prevent. A 530 probe with a fresh marker keeps
    // tunnel.json (grace window) while no tunnel is running, so the fixture
    // exercises the guarded branch without a live tunnel.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 530 })) as any;
    mkdirSync(join(tmpHome, ".use-code-cli"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".use-code-cli", "tunnel.json"),
      JSON.stringify({ url: "https://stale.trycloudflare.com", active: true, lastAliveAt: new Date().toISOString() }),
      "utf8",
    );
    try {
      const res = await GET(new Request("http://localhost/my/api/tunnel"));
      const d = await res.json();
      expect(Object.hasOwn(d, "lastAliveAt")).toBe(true);
      expect(d.lastAliveAt).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("POST /my/api/tunnel", () => {
  it("reuses an adopted URL by default and streams a short message instead of hanging", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as any;
    mkdirSync(join(tmpHome, ".use-code-cli"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".use-code-cli", "tunnel.json"),
      JSON.stringify({
        url: "https://adopted.trycloudflare.com",
        active: true,
        lastAliveAt: new Date().toISOString(),
      }),
      "utf8",
    );
    try {
      const res = await POST(new Request("http://localhost/my/api/tunnel", { method: "POST" }));
      const d = await res.json();
      expect(d.reused).toBe(true);
      expect(d.url).toBe("https://adopted.trycloudflare.com");

      const stream = await GET(new Request(`http://localhost/my/api/tunnel?stream=${d.sessionId}`));
      expect(await stream.text()).toContain("Adopted existing tunnel");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
