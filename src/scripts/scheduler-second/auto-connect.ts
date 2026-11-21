// Standalone tunnel auto-reconnect scheduling extracted from src/lib/tunnel.ts.
// Owns the reconnect/watchdog timing constants and the timer-management logic
// (schedule/clear) so it can be reused and tested in isolation. Behavior must
// stay identical to the previous inline version.

const MAX_RECONNECT_ATTEMPTS = 10;
const LAUNCH_URL_TIMEOUT_MS = 60_000;
export const schedule: string = "*/30 * * * * *";
export const timeZone: string | undefined = undefined;

interface ReconnectState {
  reconnectAttempts: number;
  reconnectPending: boolean;
  manualStop: boolean;
  autoReconnectEnabled: boolean;
}

function resolveState(input: any): ReconnectState {
  if (input?.state) return input.state as ReconnectState;

  const hasAdapters = !!(
    input?.getAttempts || input?.getPending || input?.setAttempts || input?.setPending
  );

  if (hasAdapters) {
    const s: ReconnectState = {
      get reconnectAttempts() {
        return typeof input.getAttempts === "function" ? input.getAttempts() : (input.reconnectAttempts ?? 0);
      },
      set reconnectAttempts(v: number) {
        if (typeof input.setAttempts === "function") input.setAttempts(v);
        else input.reconnectAttempts = v;
      },
      get reconnectPending() {
        return typeof input.getPending === "function" ? !!input.getPending() : !!input.reconnectPending;
      },
      set reconnectPending(v: boolean) {
        if (typeof input.setPending === "function") input.setPending(v);
        else input.reconnectPending = v;
      },
      get manualStop() {
        if (typeof input.isManualStop === "function") return !!input.isManualStop();
        if (typeof input.manualStop === "boolean") return input.manualStop;
        return false;
      },
      set manualStop(v: boolean) {
        if (typeof input.setManualStop === "function") input.setManualStop(v);
        else input.manualStop = v;
      },
      get autoReconnectEnabled() {
        if (typeof input.isAutoReconnectEnabled === "function") return !!input.isAutoReconnectEnabled();
        if (typeof input.isAutoReconnect === "function") return !!input.isAutoReconnect();
        if (typeof input.autoReconnectEnabled === "boolean") return input.autoReconnectEnabled;
        if (typeof input.autoReconnect === "boolean") return input.autoReconnect;
        return false;
      },
      set autoReconnectEnabled(v: boolean) {
        if (typeof input.setAutoReconnectEnabled === "function") input.setAutoReconnectEnabled(v);
        else if (typeof input.setAutoReconnect === "function") input.setAutoReconnect(v);
        else {
          input.autoReconnectEnabled = v;
          input.autoReconnect = v;
        }
      },
    };
    return s;
  }

  // Treat the input itself (or a fresh object) as the mutable state container.
  if (input && typeof input === "object") {
    if (typeof input.reconnectAttempts !== "number") input.reconnectAttempts = 0;
    if (!("reconnectPending" in input)) input.reconnectPending = false;
    if (typeof input.manualStop !== "boolean") input.manualStop = !!input.manualStop;
    if (typeof input.autoReconnectEnabled !== "boolean") {
      input.autoReconnectEnabled =
        typeof input.autoReconnect === "boolean" ? input.autoReconnect : false;
    }
    return input as ReconnectState;
  }

  return {
    reconnectAttempts: 0,
    reconnectPending: false,
    manualStop: false,
    autoReconnectEnabled: false,
  };
}

function resolveEvent(input: any): (msg: string) => void {
  const fn = input?.tunnelEvent ?? input?.log ?? input?.onEvent;
  if (typeof fn === "function") return fn;
  return () => {};
}

function normalizeInput(...args: any[]): any {
  if (args.length === 0) return {};
  if (args.length === 1) return args[0] ?? {};
  // scheduleReconnect(state, deps) style
  return { state: args[0], ...(args[1] ?? {}) };
}

export function clearReconnectTimer(...args: any[]): void {
  const input = normalizeInput(...args);
  const state = resolveState(input);
  state.reconnectPending = false;
}

export function scheduleReconnect(...args: any[]): any {
  const input = normalizeInput(...args);
  const state = resolveState(input);

  state.reconnectAttempts += 1;
  const event = resolveEvent(input);
  event(`scheduling reconnect attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

  // clear any pending reconnect
  state.reconnectPending = false;

  // set pending flag instead of arming a timer; execution moves to watchdog tick
  state.reconnectPending = true;
  return state.reconnectPending;
}

interface ReconnectScheduler {
  scheduleReconnect: () => any;
  clearReconnectTimer: () => void;
  state: ReconnectState;
}

export function createReconnectScheduler(options: any = {}): ReconnectScheduler {
  const state: ReconnectState =
    options?.state ??
    ({
      reconnectAttempts: options?.reconnectAttempts ?? 0,
      reconnectPending: options?.reconnectPending ?? false,
      manualStop: !!options?.manualStop,
      autoReconnectEnabled:
        typeof options?.autoReconnectEnabled === "boolean"
          ? options.autoReconnectEnabled
          : !!options?.autoReconnect,
    } as ReconnectState);

  const deps = { ...options, state };
  return {
    scheduleReconnect: () => scheduleReconnect(deps),
    clearReconnectTimer: () => clearReconnectTimer(deps),
    state,
  };
}


type WatchdogAction = "touch" | "relaunch" | "wait" | "stop";

/** Pure decision for one watchdog tick (unit-tested without timers). */
export function watchdogAction(input: {
  manualStop: boolean;
  processAlive: boolean;
  hasUrl: boolean;
  launchTimedOut?: boolean;
  backoffPending: boolean;
  autoReconnect: boolean;
  attempts: number;
  maxAttempts: number;
}): WatchdogAction {
  if (input.manualStop) return "stop";
  if (input.processAlive) {
    if (input.hasUrl) return "touch";
    if (input.launchTimedOut) {
      return input.attempts < input.maxAttempts ? "relaunch" : "stop";
    }
    return "wait";
  }
  if (input.backoffPending) return "wait";
  if (input.autoReconnect && input.attempts < input.maxAttempts) return "relaunch";
  return "stop";
}

export const scheduler = {
  MAX_RECONNECT_ATTEMPTS,
  LAUNCH_URL_TIMEOUT_MS,
  scheduleReconnect,
  clearReconnectTimer,
  watchdogAction,
  setWatchdogTick,
  run,
  schedule,
  timeZone,
};

export default scheduler;

let watchdogTick: () => void | Promise<void> = () => {};

/** Inject the watchdog tick callback invoked by `run`. */
export function setWatchdogTick(cb: () => void | Promise<void>): void {
  watchdogTick = typeof cb === "function" ? cb : () => {};
}

/** Cron-style entry point: perform one watchdog tick. */
export async function run(): Promise<void> {
  await watchdogTick();
}

