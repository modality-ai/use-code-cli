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
    render(TunnelPage());
    expect(screen().getByText(/—/)).toBeTruthy();
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

  it("uses cursor-pointer on the unlink button", () => {
    const { container } = render(TunnelPage());
    const btn = container.querySelector("#unlink-btn");
    expect(btn).toBeTruthy();
    expect(btn?.className).toContain("cursor-pointer");
  });
});
