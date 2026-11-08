import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup } from "@testing-library/react";
import React from "react";
import { render, screen } from "reshow-unit";
import SessionView from "../SessionView.client";

beforeEach(() => {
  // @ts-ignore
  if (!(globalThis as any).window) (globalThis as any).window = {} as any;
  // @ts-ignore
  if (!(globalThis as any).getComputedStyle) (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "" });
  // @ts-ignore
  (globalThis as any).window.__REACT_DATA__ = {
    sessionView: { name: "Debug --init", initial: { success: true, data: { name: "Debug --init", entries: [], online: true, status: "busy" } } },
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
    if (String(url).includes("/api/session")) {
      return { json: async () => ({ success: true, data: { name: "Debug --init", entries: [], online: true, status: "busy" } }) } as any;
    }
    if (String(url).includes("/api/talk")) {
      return { json: async () => ({ success: true, data: { success: true, message: "sent" } }) } as any;
    }
    return { json: async () => ({}) } as any;
  });
});

afterEach(() => cleanup());

describe("SessionView client", () => {
  it("renders the chat input and send button", () => {
    render(<SessionView name="Debug --init" initial={{ success: true, data: { name: "Debug --init", entries: [], online: true, status: "busy" } } as any} />);
    expect(screen().getByPlaceholderText(/Send a message/i)).toBeTruthy();
    const btn = (document as any).querySelector("#chat-send");
    expect(btn).toBeTruthy();
  });

  it("shows sent status after clicking send", async () => {
    const { container } = render(<SessionView name="Debug --init" initial={{ success: true, data: { name: "Debug --init", entries: [], online: true, status: "busy" } } as any} />);
    const input = container.querySelector("#chat-input") as HTMLInputElement;
    input.value = "hello";
    const btn = container.querySelector("#chat-send") as HTMLButtonElement;
    const { act } = await import("reshow-unit");
    await act(() => { btn.click(); }, 50);
    const status = container.querySelector("#chat-status");
    expect(status?.textContent).toContain("sent");
  });
});
