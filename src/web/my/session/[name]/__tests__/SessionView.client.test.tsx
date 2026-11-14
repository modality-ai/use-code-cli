import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { render, screen, act } from "reshow-unit";
import SessionView from "../SessionView.client";

beforeEach(() => {
  // @ts-ignore
  if (!(globalThis as any).window) (globalThis as any).window = {} as any;
  // @ts-ignore
  if (!(globalThis as any).getComputedStyle) (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "" });
  // @ts-ignore
  (globalThis as any).window.__REACT_DATA__ = {
    sessionView: { name: "Debug --init", initial: { success: true, data: { name: "Debug --init", entries: [], online: true, status: "idle" } } },
  };
  // @ts-ignore
  globalThis.EventSource = class {
    onmessage: any = null;
    onerror: any = null;
    readyState = 1;
    close() {}
    addEventListener() {}
  } as any;
  // @ts-ignore
  globalThis.fetch = mock(async (url: string) => {
    if (String(url).includes("/my/api/session")) {
      // Echo the boot payload so the mount catch-up is state-neutral in tests.
      const boot = (window as any).__REACT_DATA__?.sessionView?.initial;
      return { json: async () => boot ?? { success: true, data: { name: "Debug --init", entries: [], online: true, status: "idle" } } } as any;
    }
    if (String(url).includes("/my/api/talk")) {
      return { json: async () => ({ success: true, data: { success: true, message: "sent" } }) } as any;
    }
    return { json: async () => ({}) } as any;
  });
});

afterEach(() => cleanup());

describe("SessionView client", () => {
  it("renders the chat input and send button", async () => {
    render(<SessionView name="Debug --init" initial={{ success: true, data: { name: "Debug --init", entries: [], online: true, status: "idle" } } as any} />);
    await act();
    expect(screen().getByPlaceholderText(/Send a message/i)).toBeTruthy();
    const btn = (document as any).querySelector("#chat-send");
    expect(btn).toBeTruthy();
  });

  it("shows sent status after clicking send", async () => {
    const { container } = render(<SessionView name="Debug --init" initial={{ success: true, data: { name: "Debug --init", entries: [], online: true, status: "idle" } } as any} />);
    await act();
    const input = container.querySelector("#chat-input") as HTMLTextAreaElement;
    input.value = "hello";
    const btn = container.querySelector("#chat-send") as HTMLButtonElement;
    await act(() => { btn.click(); }, 50);
    const status = container.querySelector("#chat-status");
    expect(status?.textContent).toContain("sent");
  });

  it("shows the waiting reason in the session state line", async () => {
    const initial = { success: true, data: { name: "alpha", entries: [], online: true, status: "waiting", waitingFor: "permission prompt" } };
    (window as any).__REACT_DATA__ = { sessionView: { name: "alpha", initial } };
    const { container } = render(<SessionView name="alpha" initial={initial as any} />);
    await act();
    expect(container.querySelector("#session-state")?.textContent).toContain(
      "waiting — permission prompt",
    );
  });

  it("omits the waiting reason when the status is not waiting", async () => {
    const initial = { success: true, data: { name: "alpha", entries: [], online: true, status: "busy", waitingFor: "permission prompt" } };
    (window as any).__REACT_DATA__ = { sessionView: { name: "alpha", initial } };
    const { container } = render(<SessionView name="alpha" initial={initial as any} />);
    await act();
    const text = container.querySelector("#session-state")?.textContent ?? "";
    expect(text).toContain("busy");
    expect(text).not.toContain("permission prompt");
  });

  it("omits the waiting reason when waitingFor is absent", async () => {
    const initial = { success: true, data: { name: "alpha", entries: [], online: true, status: "waiting" } };
    (window as any).__REACT_DATA__ = { sessionView: { name: "alpha", initial } };
    const { container } = render(<SessionView name="alpha" initial={initial as any} />);
    await act();
    const text = container.querySelector("#session-state")?.textContent ?? "";
    expect(text).toContain("waiting");
    expect(text).not.toContain("—");
  });

  it("shows the resume control for a stopped session on load", async () => {
    const initial = { success: true, data: { name: "alpha", entries: [], online: true, status: "idle", stopped: true } };
    (window as any).__REACT_DATA__ = { sessionView: { name: "alpha", initial } };
    const { container } = render(<SessionView name="alpha" initial={initial as any} />);
    await act();
    expect(container.querySelector("#chat-resume")).toBeTruthy();
    expect(container.querySelector("#chat-send")).toBeNull();
  });
});
