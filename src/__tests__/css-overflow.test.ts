import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import React from "react";
import { cleanup } from "@testing-library/react";
import { render } from "reshow-unit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

describe("long English overflow (css)", () => {
  beforeEach(() => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "index.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  });
  afterEach(() => cleanup());

  it("wraps a long unbreakable token in .md-content pre", () => {
    const { container } = render(
      React.createElement("div", { className: "md-content" },
        React.createElement("pre", null, "a".repeat(200))),
    );
    const pre = container.querySelector("pre") as HTMLElement;
    const cs = (window as any).getComputedStyle(pre);
    expect(cs.overflowWrap).toBe("anywhere");
    expect(cs.whiteSpace).toBe("pre-wrap");
    expect(cs.wordBreak).toBe("break-word");
  });

  it("protects html/body/#root from horizontal overflow", () => {
    const root = document.getElementById("root") || document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    const cs = (window as any).getComputedStyle(document.documentElement);
    expect(cs.overflowWrap).toBe("anywhere");
    expect(cs.wordBreak).toBe("break-word");
  });
});