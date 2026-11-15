import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startTunnel, getTunnelStatus, readPersistedState, stopTunnel, registerLocalServer } from "../tunnel";

const pgidOf = (pid: number): string =>
  execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim();

// Fixture bind address of the fake local server this module registers — the
// tunnel has no hardcoded hosts anymore, so every spawn target flows from
// this registration (and the orphan fakes carry args pointing at it).
const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 59998;

describe("launchTunnel (detached)", () => {
  const ORIG_HOME = process.env.HOME;
  const ORIG_BIN = process.env.CLOUDFLARED_BIN;
  let tmpHome: string;
  let binDir: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "use-code-cli-launch-"));
    // Isolate the persisted state dir and tunnel.log for this module.
    process.env.HOME = tmpHome;
    // A fake cloudflared that announces a URL and stays alive. Pointed at
    // directly via CLOUDFLARED_BIN: Bun.which/Bun.spawn do not see a
    // runtime-modified PATH.
    binDir = join(tmpHome, "bin");
    mkdirSync(binDir, { recursive: true });
    // exec: the script process becomes the sleep — killing it leaves no
    // orphaned child behind.
    const script = "#!/bin/sh\necho \"your url is https://fake-" + Date.now() + ".trycloudflare.com\"\nexec sleep 300\n";
    writeFileSync(join(binDir, "cloudflared"), script);
    chmodSync(join(binDir, "cloudflared"), 0o755);
    process.env.CLOUDFLARED_BIN = join(binDir, "cloudflared");
    // The runner registers the live Bun.serve instance in production; the
    // tests register this fixture so launchTunnel has an origin to target.
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
    // Production entry: it resets manualStop (an earlier stop in this module
    // persists — module state outlives tests in one bun process).
    const res = await startTunnel();
    expect(res).not.toBeNull();

    // Wait for the URL to surface through the log-tail poller.
    let url: string | null = null;
    for (let i = 0; i < 40 && !url; i++) {
      await new Promise((r) => setTimeout(r, 100));
      url = getTunnelStatus().tunnelUrl;
    }
    expect(url).toMatch(/trycloudflare\.com$/);
    expect(readPersistedState()?.url).toBe(url);

    // Detached: setsid gave the child its own process group.
    expect(pgidOf(res!.session.proc.pid)).not.toBe(pgidOf(process.pid));

    // The pid file records the spawned child for later instances.
    const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
    expect(readFileSync(pidFile, "utf8").trim()).toBe(String(res!.session.proc.pid));

    await stopTunnel();
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(res!.session.proc.pid, 0)).toThrow();
    expect(existsSync(pidFile)).toBe(false);
  }, 10000);

  it("captures a URL split across two log-tail reads", async () => {
    // The banner arrives in two log writes more than one tail interval apart.
    const splitScript = [
      "#!/bin/sh",
      'printf "your url is https://split-"',
      "sleep 0.8",
      `echo "${Date.now()}-half.trycloudflare.com"`,
      "exec sleep 300",
      "",
    ].join("\n");
    writeFileSync(join(binDir, "cloudflared-split"), splitScript);
    chmodSync(join(binDir, "cloudflared-split"), 0o755);
    process.env.CLOUDFLARED_BIN = join(binDir, "cloudflared-split");

    try {
      const res = await startTunnel();
      expect(res).not.toBeNull();
      let url: string | null = null;
      for (let i = 0; i < 40 && !url; i++) {
        await new Promise((r) => setTimeout(r, 100));
        url = getTunnelStatus().tunnelUrl;
      }
      expect(url).toMatch(/trycloudflare\.com$/);
      expect(readPersistedState()?.url).toBe(url);
    } finally {
      await stopTunnel();
      // Restore the module fake, not ORIG_BIN: ORIG_BIN is the pre-beforeAll
      // value (usually unset), so deleting it here silently pointed every
      // later launch at the real cloudflared on PATH — hitting the real
      // Cloudflare API and failing on its 429 rate limit.
      process.env.CLOUDFLARED_BIN = join(binDir, "cloudflared");
    }
  }, 10000);

  it("stops an adopted orphan recorded in cloudflared.pid", async () => {
    // Spawned with our signature args, the fake's command line carries
    // "cloudflared ... tunnel --url" — indistinguishable from a real orphan.
    const orphan = Bun.spawn([join(binDir, "cloudflared"), "tunnel", "--url", "http://127.0.0.1:59999"], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore",
    });
    try {
      const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
      writeFileSync(pidFile, String(orphan.pid));
      await stopTunnel();
      await new Promise((r) => setTimeout(r, 200));
      expect(() => process.kill(orphan.pid, 0)).toThrow();
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      try { orphan.kill(); } catch {}
    }
  }, 10000);

  it("does not kill a recycled pid whose command is not cloudflared", async () => {
    const unrelated = Bun.spawn(["/bin/sh", "-c", "exec sleep 300"], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore",
    });
    try {
      const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
      writeFileSync(pidFile, String(unrelated.pid));
      await stopTunnel();
      await new Promise((r) => setTimeout(r, 200));
      let alive = false;
      try { process.kill(unrelated.pid, 0); alive = true; } catch {}
      expect(alive).toBe(true);
    } finally {
      try { unrelated.kill(); } catch {}
    }
  }, 10000);

  it("stops an adopted orphan bound to another loopback hostname", async () => {
    // The hostname may drift across restarts (options.host): an orphan whose
    // origin is a different loopback name than today's registration still
    // carries our spawn signature and must be stopped.
    const orphan = Bun.spawn([join(binDir, "cloudflared"), "tunnel", "--url", "http://localhost:59999"], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore",
    });
    try {
      const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
      writeFileSync(pidFile, String(orphan.pid));
      await stopTunnel();
      await new Promise((r) => setTimeout(r, 200));
      expect(() => process.kill(orphan.pid, 0)).toThrow();
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      try { orphan.kill(); } catch {}
    }
  }, 10000);

  it("stops the recorded daemon even when its target is not the current origin", async () => {
    // An explicit stop intends to stop the tunnel: whatever the pid file
    // records is stopped, as long as the process still runs cloudflared —
    // the pid file is the stop authority, so a daemon targeting another
    // origin goes down with the rest.
    writeFileSync(join(binDir, "cloudflared-lookalike"), "#!/bin/sh\nexec sleep 300\n");
    chmodSync(join(binDir, "cloudflared-lookalike"), 0o755);
    const decoy = Bun.spawn(
      [join(binDir, "cloudflared-lookalike"), "cloudflared", "tunnel", "--url", "https://elsewhere.example.com"],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );
    try {
      const pidFile = join(tmpHome, ".use-code-cli", "cloudflared.pid");
      writeFileSync(pidFile, String(decoy.pid));
      await stopTunnel();
      await new Promise((r) => setTimeout(r, 200));
      expect(() => process.kill(decoy.pid, 0)).toThrow();
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      try { decoy.kill(); } catch {}
    }
  }, 10000);

  it("launch sweeps stale untracked cloudflared processes, sparing decoys", async () => {
    // ⚠️ The sweep matches any host process carrying the loopback cloudflared
    // signature — a real tunnel running on this machine during `bun test`
    // will be SIGTERMed too.
    // An orphan with our spawn signature but no pid file / activeProc tracking:
    // the sweep must find it via the process list and stop it. No exec here —
    // exec would rename the process to `sleep` mid-test and drop the signature
    // from the command line the sweep matches on.
    // Each fake is launched through a parent shell that exits immediately, so
    // the fake reparents to launchd (ppid 1) — the sweep's orphan
    // fingerprint. A fake whose parent (this test) stays alive would be
    // spared: sparing live instances' tunnels is what keeps two coexisting
    // instances from killing each other in a loop.
    function spawnReparented(name: string, script: string, args: string): void {
      writeFileSync(join(binDir, name), script);
      chmodSync(join(binDir, name), 0o755);
      const parent = join(binDir, name + "-parent");
      writeFileSync(parent, [
        "#!/bin/sh",
        `${join(binDir, name)} ${args} &`,
        "sleep 0.1",
        "",
      ].join("\n"));
      chmodSync(parent, 0o755);
      Bun.spawn([parent], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    }
    spawnReparented("cloudflared-stale", "#!/bin/sh\necho stale\nwhile :; do sleep 1; done\n", "tunnel --url http://127.0.0.1:59998");
    // A decoy carrying the signature words but a remote target must survive
    // the sweep (same policy as stopTunnel's pid verification).
    spawnReparented("cloudflared-lookalike", "#!/bin/sh\nwhile :; do sleep 1; done\n", "cloudflared tunnel --url https://elsewhere.example.com");
    // Declared above the try: the finally must kill both fakes even when the
    // try body fails mid-test. Declaring inside the try puts them out of the
    // finally's scope — the ReferenceError is swallowed by the inner catch
    // and the decoy (spared by the sweep by design) leaks onto the host.
    let staleFakePid = NaN;
    let lookalikeFakePid = NaN;
    let orphanPid = NaN;
    let decoyPid = NaN;
    try {
      // Wait for both fakes to surface in the process list AND reparent
      // (ppid 1) — bun's spawn startup latency means a fixed sleep races the
      // parent shells, so poll until the sweep's precondition holds.
      const findPid = (pattern: string): number => {
        try {
          return Number.parseInt(execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).split("\n")[0].trim(), 10);
        } catch { return Number.NaN; } // pgrep exits non-zero when nothing matches
      };
      const ppidOf = (pid: number): number => {
        try {
          return Number.parseInt(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim(), 10);
        } catch { return Number.NaN; }
      };
      const orphanReparented = (): boolean => {
        const pid = findPid("cloudflared-stale.*tunnel --url");
        return Number.isInteger(pid) && ppidOf(pid) === 1 ? (staleFakePid = pid, true) : false;
      };
      const decoyReparented = (): boolean => {
        const pid = findPid("cloudflared-lookalike.*tunnel --url");
        return Number.isInteger(pid) && ppidOf(pid) === 1 ? (lookalikeFakePid = pid, true) : false;
      };
      for (let i = 0; i < 30 && !(staleFakePid > 0 && lookalikeFakePid > 0); i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!(staleFakePid > 0)) orphanReparented();
        if (!(lookalikeFakePid > 0)) decoyReparented();
      }
      orphanPid = staleFakePid;
      decoyPid = lookalikeFakePid;
      expect(Number.isInteger(orphanPid)).toBe(true);
      expect(Number.isInteger(decoyPid)).toBe(true);
      const res = await startTunnel();
      expect(res).not.toBeNull();
      await new Promise((r) => setTimeout(r, 300));
      let orphanAlive = false;
      try { process.kill(orphanPid, 0); orphanAlive = true; } catch {}
      expect(orphanAlive).toBe(false);
      let decoyAlive = false;
      try { process.kill(decoyPid, 0); decoyAlive = true; } catch {}
      expect(decoyAlive).toBe(true);
    } finally {
      try { process.kill(orphanPid, "SIGKILL"); } catch {}
      try { process.kill(decoyPid, "SIGKILL"); } catch {}
      await stopTunnel();
    }
  }, 10000);

  it("launch truncates an oversized tunnel.log, so a stale URL cannot win", async () => {
    // The log is append-only across launches now, so it needs the size cap:
    // seed it past the cap with a stale URL — the launch must start fresh
    // (truncating the seed) instead of letting that URL surface.
    const stateDir = join(tmpHome, ".use-code-cli");
    mkdirSync(stateDir, { recursive: true });
    const logFile = join(stateDir, "tunnel.log");
    const staleUrl = "https://stale-" + Date.now() + ".trycloudflare.com";
    writeFileSync(logFile, ("# padding\n").repeat(200_000) + "your url is " + staleUrl + "\n");
    const res = await startTunnel();
    expect(res).not.toBeNull();
    let url: string | null = null;
    for (let i = 0; i < 40 && !url; i++) {
      await new Promise((r) => setTimeout(r, 100));
      url = getTunnelStatus().tunnelUrl;
    }
    expect(url).toMatch(/trycloudflare\.com$/);
    expect(url).not.toContain("stale-");
    expect(readPersistedState()?.url).toBe(url);
    // The oversized log was truncated at this launch: the stale URL is gone.
    const logNow = readFileSync(logFile, "utf8");
    expect(logNow.length).toBeLessThan(2_000_000);
    expect(logNow).not.toContain("stale-");
    await stopTunnel();
  }, 10000);

  it("forwards cloudflared to the registered local server address", async () => {
    // Nothing is hardcoded: the forwarded URL comes from the registered
    // server instance (the getHonoUrl pattern), so the fake echoes its args.
    writeFileSync(join(binDir, "cloudflared-echo"), [
      "#!/bin/sh",
      'echo "forwarding: $@"',
      `echo "your url is https://echo-${Date.now()}.trycloudflare.com"`,
      "exec sleep 300",
      "",
    ].join("\n"));
    chmodSync(join(binDir, "cloudflared-echo"), 0o755);
    const prevBin = process.env.CLOUDFLARED_BIN;
    process.env.CLOUDFLARED_BIN = join(binDir, "cloudflared-echo");
    try {
      const res = await startTunnel();
      expect(res).not.toBeNull();
      // Wait for the echoed args to surface through the log-tail poller.
      let log = "";
      for (let i = 0; i < 40 && !log.includes("forwarding:"); i++) {
        await new Promise((r) => setTimeout(r, 100));
        log = res!.session.output.join("");
      }
      expect(log).toContain(`tunnel --url http://${LOCAL_HOST}:${LOCAL_PORT}`);
    } finally {
      await stopTunnel();
      if (prevBin === undefined) delete process.env.CLOUDFLARED_BIN;
      else process.env.CLOUDFLARED_BIN = prevBin;
    }
  }, 10000);
});
