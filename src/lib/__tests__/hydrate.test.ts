import { afterEach, describe, expect, it } from "bun:test";
import { hydrateClient } from "../hydrate";

describe("hydrateClient", () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  it("is an exported function", () => {
    expect(typeof hydrateClient).toBe("function");
  });

  it("does nothing (no throw) when document is undefined", () => {
    (globalThis as any).document = undefined;
    expect(() => hydrateClient(() => null as any)).not.toThrow();
  });

  it("does nothing (no throw) when there is no #root element", () => {
    (globalThis as any).document = {
      getElementById: (_id: string) => null,
    };
    expect(() => hydrateClient(() => null as any)).not.toThrow();
  });
});