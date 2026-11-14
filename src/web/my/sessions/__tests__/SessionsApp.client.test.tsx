import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { render, act } from "reshow-unit";
import SessionsApp from "../SessionsApp.client";

let capturedUrl: string | null = null;

beforeEach(() => {
  capturedUrl = null;
  // @ts-ignore
  if (!(globalThis as any).window) (globalThis as any).window = {} as any;
  // @ts-ignore
  (globalThis as any).window.__REACT_DATA__ = { sessions: [] };
  // @ts-ignore
  globalThis.EventSource = class {
    constructor(url: string) { capturedUrl = url; }
    onmessage: any = null;
    onerror: any = null;
    readyState = 1;
    close() {}
    addEventListener() {}
  } as any;
});

afterEach(() => cleanup());

describe("SessionsApp client", () => {
  it("connects to the renamed sessions events endpoint", () => {
    render(<SessionsApp initial={[]} />);
    expect(capturedUrl).not.toBeNull();
    expect(String(capturedUrl)).toContain("/my/api/sessions/events");
  });

  it("renders empty state", () => {
    const { container } = render(<SessionsApp initial={[]} />);
    expect(container.textContent).toContain("No active sessions");
  });

  it("shows the waiting reason next to a waiting session", () => {
    (window as any).__REACT_DATA__ = {
      sessions: [{ name: "alpha", sessionId: "sid-1", status: "waiting", waitingFor: "permission prompt" }],
    };
    const { container } = render(<SessionsApp initial={[]} />);
    expect(container.textContent).toContain("waiting — permission prompt");
  });

  it("omits the waiting reason when the status is not waiting", () => {
    (window as any).__REACT_DATA__ = {
      sessions: [{ name: "alpha", sessionId: "sid-1", status: "busy", waitingFor: "permission prompt" }],
    };
    const { container } = render(<SessionsApp initial={[]} />);
    act();
    expect(container.textContent).toContain("busy");
    expect(container.textContent).not.toContain("permission prompt");
  });
});
