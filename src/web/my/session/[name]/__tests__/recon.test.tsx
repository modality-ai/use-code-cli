import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { render, screen, act } from "reshow-unit";
import SessionView from "../SessionView.client";

beforeEach(() => {
  if (!(globalThis as any).window) (globalThis as any).window = {} as any;
  if (!(globalThis as any).getComputedStyle) (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "" });
  (globalThis as any).window.__REACT_DATA__ = { sessionView: { name: "Debug --init", initial: { success: true, data: { name: "Debug --init", entries: [], online: true, status: "idle" } } } };
  globalThis.EventSource = class { onmessage: any = null; onerror: any = null; readyState = 1; close() {} addEventListener() {} } as any;
  globalThis.fetch = mock(async (url: string) => {
    if (String(url).includes("/my/api/session")) {
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

describe("recon", () => {
  it("shows optimistic after submit", async () => {
    const { container } = render(<SessionView name="Debug --init" initial={{ success: true, data: { name: "Debug --init", entries: [], online: true, status: "idle" } } as any} />);
    await act();
    const input = container.querySelector("#chat-input") as HTMLTextAreaElement;
    input.value = "hello";
    const btn = container.querySelector("#chat-send") as HTMLButtonElement;
    await act(() => { btn.click(); });
    expect(container.querySelector("[data-optimistic]")).toBeTruthy();
  });
});
