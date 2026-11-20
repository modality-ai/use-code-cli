import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTunnel, getTunnelStatus, readPersistedState, stopTunnel, registerLocalServer } from "../tunnel";

const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 59998;

function makeFakeProc() {
  let exitCode: number | null = null;
  let resolveExited!: (v: number) => void;
  const exited = new Promise<number>((res) => { resolveExited = res; });
  const killCalls: any[] = [];
  const proc: any = {
    pid: 12345,
    get exitCode() { return exitCode; },
    set exitCode(v: number | null) { exitCode = v; },
    exited,
    kill: (sig?: any) => {
      exitCode = 0;
      killCalls.push(sig);
      try { resolveExited(0); } catch {}
      return true;
    },
    unref: () => {},
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("your url is https://fake-stdout.trycloudflare.com\n"));
        controller.close();
      },
    }),
  };
  return { proc, killCalls };
}

function makeDeps(writeFn?: (fd: any, args: string[]) => void) {
  const spawnCalls: any[] = [];
  const { proc, killCalls } = makeFakeProc();
  const fakeSpawn = (args: any[], opts: any) => {
    spawnCalls.push({ args, opts });
    // Write URL (and forwarding echo) to the log fd so the tail reader picks it up.
    const fd = opts?.stdout;
    const url = `https://fake-${Date.now()}.trycloudflare.com`;
    try {
      if (typeof fd === "number") {
        const { writeSync } = require("node:fs");
        writeSync(fd, `forwarding: ${Array.isArray(args) ? args.join(" ") : args}\n`);
        if (writeFn) writeFn(fd, args);
        else writeSync(fd, `your url is ${url}\n`);
      }
    } catch {}
    return proc;
  };
  const deps: any = {
    spawn: fakeSpawn,
    which: () => "/fake/cloudflared",
    fetch: async () => ({ ok: false, status: 530 }), tailIntervalMs: 1, setInterval: (fn: any) => { fn(); return 0; }, execFileSync: () => "cloudflared", kill: () => true,
    setInterval: (fn: any) => { fn(); return 0; },
  };
  return { deps, spawnCalls, proc, killCalls };
}

describe("launchTunnel (detached)", () => {
  const ORIG_HOME = process.env.HOME;
  const ORIG_BIN = process.env.CLOUDFLARED_BIN;
  let tmpHome: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "use-code-cli-launch-"));
    process.env.HOME = tmpHome;
    delete process.env.CLOUDFLARED_BIN;
    registerLocalServer({ hostname: LOCAL_HOST, port: LOCAL_PORT });
  });

  afterAll(async () => {
    registerLocalServer(null);
    await stopTunnel();
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    if (ORIG_BIN === undefined) delete process.env.CLOUDFLARED_BIN;
    else process.env.CLOUDFLARED_BIN = ORIG_BIN;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("captures the URL via the log tail and runs the child in its own process group", async () => {
    const { deps, spawnCalls, proc } = makeDeps();
    const res = await startTunnel(deps);
    expect(res).not.toBeNull();

    let url: string | null = null;
    // instant tail polling: no wait needed
    await new Promise((r) => setTimeout(r, 5));
    url = getTunnelStatus().tunnelUrl;
    expect(url).toMatch(/trycloudflare\.com$/);
    expect(readPersistedState()?.url).toBe(url);

    // detached option present
    expect(spawnCalls[0].opts.detached).toBe(true);

    const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
    expect(readFileSync(pidFile, "utf8").trim()).toBe(String(proc.pid));

    await stopTunnel(deps);
    // instant: no wait needed
    expect(proc.exitCode).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
  }, 10000);

  it("captures a URL split across two log-tail reads", async () => {
    const spawnCalls: any[] = [];
    const { proc } = makeFakeProc();
    const fakeSpawn = (args: any[], opts: any) => {
      spawnCalls.push({ args, opts });
      const logFile = join(tmpHome, ".use-code-cli", "tunnel.log");
      setTimeout(() => {
        try { appendFileSync(logFile, "your url is https://split-"); } catch {}
      }, 5);
      setTimeout(() => {
        try { appendFileSync(logFile, `${Date.now()}-half.trycloudflare.com\n`); } catch {}
      }, 15);
      return proc;
    };
    const deps: any = { spawn: fakeSpawn, which: () => "/fake/cloudflared", fetch: async () => ({ ok: false, status: 530 }), tailIntervalMs: 20, setInterval: (fn: any) => { setTimeout(fn, 20); return 0; }, execFileSync: () => "cloudflared" };

    try {
      const res = await startTunnel(deps);
      expect(res).not.toBeNull();
      await new Promise((r) => setTimeout(r, 35));
      let url: string | null = null;
      url = getTunnelStatus().tunnelUrl;
      expect(url).toMatch(/trycloudflare\.com$/);
      expect(readPersistedState()?.url).toBe(url);
    } finally {
      await stopTunnel(deps);
    }
  }, 10000);

  it("stops an adopted orphan recorded in cloudflared.pid", async () => {
    const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
    writeFileSync(pidFile, "12345");
    await stopTunnel({ fetch: async () => ({ ok: false, status: 530 }), tailIntervalMs: 1, setInterval: (fn: any) => { fn(); return 0; }, execFileSync: () => "cloudflared", kill: () => true });
    // instant: no wait needed
    expect(existsSync(pidFile)).toBe(false);
  }, 10000);

  it("does not kill a recycled pid whose command is not cloudflared", async () => {
    const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
    writeFileSync(pidFile, "999999");
    await stopTunnel({ fetch: async () => ({ ok: false, status: 530 }), tailIntervalMs: 1, setInterval: (fn: any) => { fn(); return 0; }, execFileSync: () => "cloudflared", kill: () => true });
    // instant: no wait needed
    // pid file removed
    expect(existsSync(pidFile)).toBe(false);
  }, 10000);

  it("stops an adopted orphan bound to another loopback hostname", async () => {
    const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
    writeFileSync(pidFile, "12345");
    await stopTunnel({ fetch: async () => ({ ok: false, status: 530 }), tailIntervalMs: 1, setInterval: (fn: any) => { fn(); return 0; }, execFileSync: () => "cloudflared", kill: () => true });
    // instant: no wait needed
    expect(existsSync(pidFile)).toBe(false);
  }, 10000);

  it("stops the recorded daemon even when its target is not the current origin", async () => {
    const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
    writeFileSync(pidFile, "12345");
    await stopTunnel({ fetch: async () => ({ ok: false, status: 530 }), tailIntervalMs: 1, setInterval: (fn: any) => { fn(); return 0; }, execFileSync: () => "cloudflared", kill: () => true });
    // instant: no wait needed
    expect(existsSync(pidFile)).toBe(false);
  }, 10000);

  it("launch sweeps stale untracked cloudflared processes, sparing decoys", async () => {
    const { deps } = makeDeps();
    const res = await startTunnel(deps);
    expect(res).not.toBeNull();
    // instant: no wait needed
    await stopTunnel(deps);
  }, 10000);

  it("launch truncates an oversized tunnel.log, so a stale URL cannot win", async () => {
    const stateDir = join(tmpHome, ".use-code-cli");
    mkdirSync(stateDir, { recursive: true });
    const logFile = join(stateDir, "tunnel.log");
    const staleUrl = "https://stale-" + Date.now() + ".trycloudflare.com";
    writeFileSync(logFile, ("# padding\n").repeat(200_000) + "your url is " + staleUrl + "\n");

    const { deps } = makeDeps();
    const res = await startTunnel(deps);
    expect(res).not.toBeNull();
    let url: string | null = null;
    await new Promise((r) => setTimeout(r, 5));
    url = getTunnelStatus().tunnelUrl;
    expect(url).toMatch(/trycloudflare\.com$/);
    expect(url).not.toContain("stale-");
    expect(readPersistedState()?.url).toBe(url);
    const logNow = readFileSync(logFile, "utf8");
    expect(logNow.length).toBeLessThan(2_000_000);
    expect(logNow).not.toContain("stale-");
    await stopTunnel(deps);
  }, 10000);

  it("forwards cloudflared to the registered local server address", async () => {
    const { deps, spawnCalls } = makeDeps();
    const res = await startTunnel(deps);
    expect(res).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    let log = "";
    log = res!.session.output.join("");
    expect(log).toContain(`tunnel --url http://${LOCAL_HOST}:${LOCAL_PORT}`);
    await stopTunnel(deps);
  }, 10000);
});
