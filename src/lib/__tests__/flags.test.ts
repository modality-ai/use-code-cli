import { describe, expect, it } from "bun:test";
import { filterStatusField } from "../flags";

describe("filterStatusField", () => {
  it("is optional — undefined parses", () => {
    expect(filterStatusField.safeParse(undefined).success).toBe(true);
  });

  it("accepts a known status", () => {
    expect(filterStatusField.safeParse("idle")).toEqual({
      success: true,
      data: "idle",
    });
  });

  it("accepts a comma-separated list with spaces", () => {
    expect(filterStatusField.safeParse("busy, idle").success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(filterStatusField.safeParse("bogus").success).toBe(false);
  });

  it("rejects when any term is unknown", () => {
    expect(filterStatusField.safeParse("busy,bogus").success).toBe(false);
  });
});
