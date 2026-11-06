import { afterEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import { render, screen } from "reshow-unit";
import ClaudeLoginPage from "../page";

afterEach(() => cleanup());

describe("ClaudeLoginPage", () => {
  it("renders status summary when status provided", () => {
    render(ClaudeLoginPage({ status: { loggedIn: true, mode: "claudeai" } } as any));
    expect(screen().getByText(/loggedIn/i)).toBeTruthy();
  });

  it("shows unavailable when no status", () => {
    render(ClaudeLoginPage({ status: null } as any));
    expect(screen().getByText(/Status unavailable/i)).toBeTruthy();
  });

  it("renders the login heading", () => {
    render(ClaudeLoginPage({ status: null } as any));
    expect(screen().getByText(/Claude Code Login/i)).toBeTruthy();
  });
});
