import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { label, decodeHtmlText, teaserOf, updateBar } from "../SessionView.client";

beforeEach(() => {
  // @ts-ignore
  if (!(globalThis as any).getComputedStyle) (globalThis as any).getComputedStyle = () => ({ borderTopWidth: "0", paddingTop: "0", getPropertyValue: () => "" });
});
afterEach(() => {
  // noop
});

describe("label", () => {
  it("returns user label for user entries", () => {
    expect(label({ role: "user" } as any)).toBe("❯ You");
  });
  it("returns recap label for system entries", () => {
    expect(label({ role: "system" } as any)).toBe("📋 Recap");
  });
  it("returns claude label for assistant entries", () => {
    expect(label({ role: "assistant" } as any)).toBe("⏺ Claude");
  });
  it("defaults to claude label when role is missing", () => {
    expect(label({} as any)).toBe("⏺ Claude");
  });
});

describe("decodeHtmlText", () => {
  it("strips html tags (replaced with space)", () => {
    expect(decodeHtmlText("<p>hello</p>")).toBe(" hello ");
  });
  it("decodes named entities", () => {
    expect(decodeHtmlText("a &lt; b &amp; c &gt; d")).toBe("a < b & c > d");
  });
  it("decodes numeric entities", () => {
    expect(decodeHtmlText("&#65;&#66;")).toBe("AB");
  });
  it("decodes quotes and nbsp", () => {
    expect(decodeHtmlText("&quot;x&#39;y&nbsp;z")).toBe('"x\'y z');
  });
});

describe("teaserOf", () => {
  it("uses text when present and normalizes whitespace", () => {
    expect(teaserOf({ text: "  hello   world  " } as any)).toBe("hello world");
  });
  it("falls back to decoded html", () => {
    expect(teaserOf({ html: "<p>hi &amp; bye</p>" } as any)).toBe("hi & bye");
  });
  it("truncates to 200 chars", () => {
    expect(teaserOf({ text: "a".repeat(300) } as any).length).toBe(200);
  });
  it("returns empty string for empty entry", () => {
    expect(teaserOf({} as any)).toBe("");
  });
});

describe("updateBar", () => {
  function makeRoot(bottoms: number[]) {
    const els = bottoms.map((b) => ({
      getBoundingClientRect: () => ({ bottom: b, top: 0, left: 0, right: 0, width: 0, height: 0 }) as any,
      dataset: {} as any,
    }));
    const root: any = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as any,
      querySelectorAll: (_sel: string) => ({
        length: els.length,
        item: (i: number) => els[i] ?? null,
      }) as any,
    };
    return root;
  }

  it("returns null for null root", () => {
    expect(updateBar(null, [], null)).toBeNull();
  });

  it("returns null when no user entry has scrolled past", () => {
    const entries = [{ role: "user", text: "hi" }];
    const root = makeRoot([10]);
    expect(updateBar(root, entries as any, null)).toBeNull();
  });

  it("picks the most recent user entry fully scrolled past", () => {
    const entries = [
      { role: "user", text: "first" },
      { role: "assistant", text: "reply" },
      { role: "user", text: "second" },
    ];
    const root = makeRoot([ -5, 50, -10 ]);
    const res = updateBar(root, entries as any, null);
    expect(res).not.toBeNull();
    expect(res!.index).toBe(2);
    expect(res!.teaser).toBe("second");
  });

  it("returns the same last reference when index unchanged", () => {
    const entries = [{ role: "user", text: "first" }];
    const root = makeRoot([-5]);
    const last = { index: 0, teaser: "first" };
    const res = updateBar(root, entries as any, last as any);
    expect(res).toBe(last);
  });

  it("uses dataset.role fallback for role detection", () => {
    const el: any = {
      getBoundingClientRect: () => ({ bottom: -5, top: 0, left: 0, right: 0, width: 0, height: 0 }),
      dataset: { role: "user" },
    };
    const root: any = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      querySelectorAll: () => ({ length: 1, item: () => el }),
    };
    const entries = [{}] as any;
    const res = updateBar(root, entries, null);
    expect(res).not.toBeNull();
    expect(res!.index).toBe(0);
  });
});