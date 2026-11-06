import { afterEach, describe, expect, it } from "bun:test";
import { cleanup } from "@testing-library/react";
import { render, screen } from "reshow-unit";
import DesignPage from "../page";

afterEach(() => cleanup());

describe("DesignPage", () => {
  it("renders the provided rendered html inside an article", () => {
    render(DesignPage({ rendered: "<p>hello design</p>" } as any));
    expect(screen().getByText(/hello design/i)).toBeTruthy();
  });
});
