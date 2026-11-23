import { describe, expect, it } from "bun:test";
import { preprocessProjectRunArgv } from "../project-run-argv";

describe("preprocessProjectRunArgv", () => {
  it("passes through argv for unrelated commands", () => {
    const argv = ["projects", "--foo", "bar"];
    expect(preprocessProjectRunArgv(argv)).toEqual({ argv });
  });

  it("rewrites a single trailing positional into --cmd", () => {
    expect(preprocessProjectRunArgv(["project-run", "pwd"])).toEqual({
      argv: ["project-run", "--cmd=pwd"],
    });
  });

  it("splits two positionals into target + --cmd", () => {
    expect(preprocessProjectRunArgv(["project-run", "/w/proj", "echo", "hi"])).toEqual({
      argv: ["project-run", "/w/proj", "--cmd=echo hi"],
    });
  });

  it("moves target into --project flag value when --project is already present", () => {
    expect(
      preprocessProjectRunArgv(["project-run", "--project", "/w/proj", "/w/proj", "echo", "hi"]),
    ).toEqual({
      argv: ["project-run", "--project", "/w/proj", "--cmd=echo hi"],
    });
  });

  it("converts -- separator into --cmd=", () => {
    expect(preprocessProjectRunArgv(["project-run", "--project", "/w/proj", "--", "echo", "hello", "world"])).toEqual({
      argv: ["project-run", "--project", "/w/proj", "--cmd=echo hello world"],
    });
  });

  it("converts --- separator into --cmd=", () => {
    expect(preprocessProjectRunArgv(["project-run", "---", "ls", "-la"])).toEqual({
      argv: ["project-run", "--cmd=ls -la"],
    });
  });

  it("drops the command when -- separator has no tail", () => {
    expect(preprocessProjectRunArgv(["project-run", "--project", "/w/proj", "--"])).toEqual({
      argv: ["project-run", "--project", "/w/proj"],
    });
  });

  it("works for all registered command aliases", () => {
    for (const name of ["project-run", "project-exec", "run-project"]) {
      expect(preprocessProjectRunArgv([name, "pwd"])).toEqual({
        argv: [name, "--cmd=pwd"],
      });
    }
  });
});
