import { describe, expect, it } from "bun:test";
import {
  reconnectDelay,
  watchdogAction,
  scheduleReconnect,
  clearReconnectTimer,
  createReconnectScheduler,
} from "../auto-connect";

describe("auto-connect reconnectDelay", () => {
  it("attempt 1 → 1000ms", () => {
    expect(reconnectDelay(1)).toBe(1000);
  });
  it("caps at 30000ms", () => {
    expect(reconnectDelay(10)).toBe(30000);
  });
});

describe("auto-connect watchdogAction", () => {
  it("returns stop when manualStop", () => {
    expect(watchdogAction({ manualStop: true, processAlive: true, hasUrl: true, backoffPending: false, autoReconnect: true, attempts: 0, maxAttempts: 10 })).toBe("stop");
  });
  it("returns touch when alive with url", () => {
    expect(watchdogAction({ manualStop: false, processAlive: true, hasUrl: true, backoffPending: false, autoReconnect: true, attempts: 0, maxAttempts: 10 })).toBe("touch");
  });
});

describe("auto-connect scheduleReconnect", () => {
  it("increments attempts and sets pending flag", () => {
    let attempts = 0;
    let pending = false;
    const deps = {
      getAttempts: () => attempts,
      setAttempts: (n: number) => { attempts = n; },
      getPending: () => pending,
      setPending: (v: boolean) => { pending = v; },
      isManualStop: () => false,
      isAutoReconnectEnabled: () => true,
      launch: () => {},
      tunnelEvent: () => {},
    };
    const t = scheduleReconnect(deps);
    expect(attempts).toBe(1);
    expect(pending).toBe(true);
    expect(t).toBe(true);
  });

  it("does not launch during schedule (pending flag only)", () => {
    let attempts = 0;
    let pending = false;
    const deps = {
      getAttempts: () => attempts,
      setAttempts: (n: number) => { attempts = n; },
      getPending: () => pending,
      setPending: (v: boolean) => { pending = v; },
      isManualStop: () => true,
      isAutoReconnectEnabled: () => true,
      launch: () => { throw new Error("should not launch during schedule"); },
      tunnelEvent: () => {},
    };
    scheduleReconnect(deps);
    expect(attempts).toBe(1);
    expect(pending).toBe(true);
  });
});

describe("auto-connect clearReconnectTimer", () => {
  it("clears the pending flag", () => {
    let pending = true;
    const deps = {
      getPending: () => pending,
      setPending: (v: boolean) => { pending = v; },
    };
    clearReconnectTimer(deps);
    expect(pending).toBe(false);
  });
});

describe("auto-connect createReconnectScheduler", () => {
  it("returns scheduleReconnect/clearReconnectTimer/state", () => {
    const s = createReconnectScheduler({ autoReconnectEnabled: true });
    expect(typeof s.scheduleReconnect).toBe("function");
    expect(typeof s.clearReconnectTimer).toBe("function");
    expect(s.state).toBeDefined();
  });
});