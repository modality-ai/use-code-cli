import { afterEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import { render, screen } from "reshow-unit";
import TunnelPage from "../page";

afterEach(() => cleanup());

describe("TunnelPage", () => {
  it("renders the heading", () => {
    render(TunnelPage());
    expect(screen().getByText(/Tunnel \(cloudflared\)/i)).toBeTruthy();
  });

  it("renders the create & link button", () => {
    render(TunnelPage());
    expect(screen().getByText(/Create & Link tunnel/i)).toBeTruthy();
  });

  it("renders the unlink button", () => {
    render(TunnelPage());
    expect(screen().getByText(/Unlink/i)).toBeTruthy();
  });

  it("shows placeholder when no url", () => {
    // Query the URL span directly: the "Last alive" placeholder is also "—",
    // so a bare getByText(/—/) would match two elements.
    const { container } = render(TunnelPage());
    const el = container.querySelector("#tunnel-url");
    expect(el?.textContent).toBe("—");
  });

  it("shows provided url", () => {
    render(TunnelPage({ url: "https://example.trycloudflare.com" } as any));
    expect(screen().getByText(/https:\/\/example.trycloudflare.com/i)).toBeTruthy();
  });

  it("uses cursor-pointer on the create button", () => {
    const { container } = render(TunnelPage());
    const btn = container.querySelector("#tunnel-btn");
    expect(btn).toBeTruthy();
    expect(btn?.className).toContain("cursor-pointer");
  });

  it("shows a redirect-to-sign-in message on a 401 poll, not the cloudflared-not-found text", async () => {
    // A 401 means the session is gone — a broken-looking "cloudflared not
    // found" line would mislead a user who believes they are signed in. The
    // 1.5s redirect timer must not fire inside the test window.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ status: 401, json: async () => ({ success: false, error: "unauthorized" }) })) as any;
    try {
      const { container } = render(TunnelPage());
      await new Promise((r) => setTimeout(r, 50));
      const statusEl = container.querySelector("#tunnel-status");
      expect(statusEl?.textContent).toBe("Not signed in — redirecting to sign in…");
      expect(statusEl?.textContent).not.toContain("cloudflared not found");
      expect(container.querySelector("#tunnel-url")?.textContent).toBe("—");
    } finally {
      globalThis.fetch = origFetch;
      cleanup();
    }
  });

  it("shows the fetched lastAliveAt in the Last alive span", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      json: async () => ({ success: true, version: "2026.1", url: "https://live.trycloudflare.com", lastAliveAt: "2026-11-15T02:00:00.000Z" }),
    })) as any;
    try {
      const { container } = render(TunnelPage());
      await new Promise((r) => setTimeout(r, 50));
      expect(container.querySelector("#tunnel-last-alive")?.textContent).toBe("2026-11-15T02:00:00.000Z");
    } finally {
      globalThis.fetch = origFetch;
      cleanup();
    }
  });

  it("repeated 401 polls schedule one redirect, not a stack, and reset Last alive to —", async () => {
    // The ref guard keeps every 401 poll from scheduling its own 1.5s
    // redirect: after the second poll (the 2s interval), exactly one timer
    // must be pending. 1500ms callbacks are swallowed so the redirect never
    // navigates the test DOM, but they stay countable.
    const origFetch = globalThis.fetch;
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const scheduled = new Set<any>();
    const cleared: any[] = [];
    globalThis.fetch = (async () => ({ status: 401, json: async () => ({ success: false, error: "unauthorized" }) })) as any;
    globalThis.setTimeout = ((fn: any, delay?: number, ...rest: any[]) => {
      if (delay === 1500) {
        const fakeId = {};
        scheduled.add(fakeId);
        return fakeId;
      }
      return (origSetTimeout as any)(fn, delay, ...rest);
    }) as any;
    globalThis.clearTimeout = ((id: any) => {
      if (scheduled.has(id)) {
        scheduled.delete(id);
        cleared.push(id);
        return;
      }
      return (origClearTimeout as any)(id);
    }) as any;
    try {
      const { container } = render(TunnelPage());
      await new Promise((r) => setTimeout(r, 50)); // first poll
      await new Promise((r) => (origSetTimeout as any)(r, 2100)); // second poll at the 2s interval
      expect(container.querySelector("#tunnel-status")?.textContent).toBe("Not signed in — redirecting to sign in…");
      expect(container.querySelector("#tunnel-last-alive")?.textContent).toBe("—");
      expect([...scheduled.keys()]).toHaveLength(1);
      cleanup(); // unmount inside the redirect window: the pending timer must be cleared
      expect([...scheduled.keys()]).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
      globalThis.setTimeout = origSetTimeout;
      globalThis.clearTimeout = origClearTimeout;
      cleanup();
    }
  });

  it("a successful poll after a 401 cancels the pending redirect", async () => {
    // The session can recover inside the 1.5s redirect window (auth refresh,
    // cookie race): the success path must clear the pending timer instead of
    // sending the just-restored user to the sign-in page.
    const origFetch = globalThis.fetch;
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const scheduled = new Set<any>();
    globalThis.setTimeout = ((fn: any, delay?: number, ...rest: any[]) => {
      if (delay === 1500) {
        const fakeId = {};
        scheduled.add(fakeId);
        return fakeId;
      }
      return (origSetTimeout as any)(fn, delay, ...rest);
    }) as any;
    globalThis.clearTimeout = ((id: any) => {
      if (scheduled.has(id)) {
        scheduled.delete(id);
        return;
      }
      return (origClearTimeout as any)(id);
    }) as any;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      // First poll: 401 (auth gone). Later polls: the session has recovered.
      if (calls === 1) return { status: 401, json: async () => ({ success: false, error: "unauthorized" }) } as any;
      return { status: 200, json: async () => ({ success: true, version: "2026.1", url: "https://live.trycloudflare.com" }) } as any;
    }) as any;
    try {
      const { container } = render(TunnelPage());
      await new Promise((r) => setTimeout(r, 50)); // first poll: 401 schedules the redirect
      expect([...scheduled.keys()]).toHaveLength(1);
      await new Promise((r) => (origSetTimeout as any)(r, 2100)); // second poll at the 2s interval: success cancels it
      expect([...scheduled.keys()]).toHaveLength(0);
      expect(container.querySelector("#tunnel-status")?.textContent).toBe("cloudflared: 2026.1");
    } finally {
      globalThis.fetch = origFetch;
      globalThis.setTimeout = origSetTimeout;
      globalThis.clearTimeout = origClearTimeout;
      cleanup();
    }
  });

  it("uses cursor-pointer on the unlink button", () => {
    const { container } = render(TunnelPage());
    const btn = container.querySelector("#unlink-btn");
    expect(btn).toBeTruthy();
    expect(btn?.className).toContain("cursor-pointer");
  });
});
