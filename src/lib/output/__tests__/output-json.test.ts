import { describe, expect, it } from "bun:test";
import { prettyJson, prettyJsonFile, tryPrettyJson, DEFAULT_JSON_INDENT } from "../json";

describe("prettyJson", () => {
  it("pretty-prints a value", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("uses default indent 2", () => {
    expect(DEFAULT_JSON_INDENT).toBe(2);
  });
});

describe("prettyJsonFile", () => {
  it("adds a trailing newline", () => {
    expect(prettyJsonFile({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("tryPrettyJson", () => {
  it("returns null for non-string", () => {
    expect(tryPrettyJson(42)).toBeNull();
  });

  it("pretty-prints valid JSON text", () => {
    expect(tryPrettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("returns null for invalid JSON", () => {
    expect(tryPrettyJson("not json")).toBeNull();
  });
});
