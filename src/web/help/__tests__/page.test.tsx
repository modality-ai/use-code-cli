import { afterEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import { render, screen } from "reshow-unit";
import HelpPage from "../page";

afterEach(() => cleanup());

describe("HelpPage", () => {
  it("renders the server heading", () => {
    render(HelpPage());
    expect(screen().getByText(/use-code-cli server/i)).toBeTruthy();
  });

  it("lists the endpoints", () => {
    render(HelpPage());
    expect(screen().getByText(/GET \/sessions/i)).toBeTruthy();
    expect(screen().getByText(/GET \/design/i)).toBeTruthy();
    expect(screen().getByText(/GET \/help/i)).toBeTruthy();
  });
});
