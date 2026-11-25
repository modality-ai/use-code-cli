import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { bunMockModule } from "modality-bun-kit";
import { fileURLToPath } from "node:url";
import { cleanup } from "@testing-library/react";
import React from "react";
import { render, act } from "reshow-unit";

// The login flow's WebAuthn step is browser-only; what changed here is the
// redirect guard around it, so stub the authenticator interaction.
const resetWebauthn = await bunMockModule(fileURLToPath(import.meta.resolve("@simplewebauthn/browser")), () => ({
  startRegistration: async () => ({}),
  startAuthentication: async () => ({ response: "stub" }),
}));

afterAll(() => resetWebauthn());

const { default: PasskeyApp } = await import("../PasskeyApp.client");

// Observation harness for the 1.5s redirect timer: 1500ms callbacks are
// swallowed (a fired redirect would navigate the test DOM) but still tracked,
// so pending/stacked timers stay countable. Everything else passes through.
let scheduled = new Set<any>();
let cleared: any[] = [];
const ORIG_SET_TIMEOUT = globalThis.setTimeout;
const ORIG_CLEAR_TIMEOUT = globalThis.clearTimeout;

function trackRedirectTimers() {
  scheduled = new Set();
  cleared = [];
  globalThis.setTimeout = ((fn: any, delay?: number, ...rest: any[]) => {
    if (delay === 1500) {
      const fakeId = {};
      scheduled.add(fakeId);
      return fakeId;
    }
    return (ORIG_SET_TIMEOUT as any)(fn, delay, ...rest);
  }) as any;
  globalThis.clearTimeout = ((id: any) => {
    if (scheduled.has(id)) {
      scheduled.delete(id);
      cleared.push(id);
      return;
    }
    return (ORIG_CLEAR_TIMEOUT as any)(id);
  }) as any;
}

beforeEach(() => {
  // @ts-ignore
  if (!(globalThis as any).window) (globalThis as any).window = {} as any;
  // @ts-ignore
  if (!(globalThis as any).getComputedStyle) (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "" });
  // @ts-ignore
  globalThis.fetch = mock(async (url: string) => {
    if (String(url).includes("/api/webauthn/login/options")) {
      return { json: async () => ({ success: true, options: {}, challengeId: "c1" }) } as any;
    }
    if (String(url).includes("/api/webauthn/login/verify")) {
      return { json: async () => ({ success: true }) } as any;
    }
    return { json: async () => ({ authenticated: false }) } as any;
  });
});

afterEach(() => {
  globalThis.setTimeout = ORIG_SET_TIMEOUT;
  globalThis.clearTimeout = ORIG_CLEAR_TIMEOUT;
  cleanup();
});

describe("PasskeyApp client", () => {
  it("redirects after a successful login, clearing a re-click's stale timer instead of stacking", async () => {
    trackRedirectTimers();
    const { container } = render(<PasskeyApp />);
    await act(); // mount status fetch
    const loginBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Login") as HTMLButtonElement;
    expect(loginBtn).toBeTruthy();
    await act(() => { loginBtn.click(); }, 50); // first successful login
    expect(container.querySelector("pre")?.textContent).toBe("Signed in. Redirecting...");
    await act(() => { loginBtn.click(); }, 50); // re-click inside the redirect window
    // The re-click cleared the first timer before scheduling its own: exactly
    // one pending redirect remains.
    expect([...scheduled.keys()]).toHaveLength(1);
    expect(cleared).toHaveLength(1);
    cleanup(); // unmount inside the window: the pending timer must be gone
    expect([...scheduled.keys()]).toHaveLength(0);
  });
});
