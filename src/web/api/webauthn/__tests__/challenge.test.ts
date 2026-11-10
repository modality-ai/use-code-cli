import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  consumeChallenge,
  getChallenge,
  latestChallengeId,
  resetChallenges,
  saveChallenge,
} from "../challenge";

beforeEach(() => {
  resetChallenges();
});

afterEach(() => {
  resetChallenges();
});

describe("saveChallenge/getChallenge", () => {
  it("stores and retrieves a challenge", () => {
    saveChallenge("id1", "challenge-value");
    expect(getChallenge("id1")).toBe("challenge-value");
  });
  it("returns null for missing id", () => {
    expect(getChallenge("nope")).toBeNull();
  });
  it("expires challenges", () => {
    saveChallenge("id1", "challenge-value", -1000);
    expect(getChallenge("id1")).toBeNull();
  });
  it("deletes expired entry on read", () => {
    saveChallenge("id1", "challenge-value", -1000);
    getChallenge("id1");
    // re-saving not needed; ensure not retrievable
    expect(getChallenge("id1")).toBeNull();
  });
});

describe("consumeChallenge", () => {
  it("returns and removes challenge", () => {
    saveChallenge("id1", "challenge-value");
    expect(consumeChallenge("id1")).toBe("challenge-value");
    expect(getChallenge("id1")).toBeNull();
  });
  it("returns null when expired without deleting leftover? (expired)", () => {
    saveChallenge("id1", "challenge-value", -1000);
    expect(consumeChallenge("id1")).toBeNull();
  });
});

describe("latestChallengeId", () => {
  it("null when empty", () => {
    expect(latestChallengeId()).toBeNull();
  });
  it("returns most recently inserted key", () => {
    saveChallenge("a", "1");
    saveChallenge("b", "2");
    expect(latestChallengeId()).toBe("b");
  });
});

describe("resetChallenges", () => {
  it("clears all", () => {
    saveChallenge("a", "1");
    resetChallenges();
    expect(getChallenge("a")).toBeNull();
    expect(latestChallengeId()).toBeNull();
  });
});
