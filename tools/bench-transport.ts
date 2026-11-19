#!/usr/bin/env bun
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile, openSync } from "node:fs/promises";
import { openSync as fsOpenSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { deliver, type LiveSession } from "../src/lib/peer";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return fallback;
}

const TARGETS = arg("targets", 20);
const ROUNDS = arg("rounds", 10);

const MESSAGE =
  "Benchmark payload — line 1\n" +
  "第二行：含中文、emoji-ish、backticks: `code` and ```fence```\n" +
  "Third line with tabs\tand spaces   end\n" +
  "Fourth line: a]b[c{d}e(f)g\n" +
  "Final line: done.\n";

const END_MARKER = "<<<END>>>";

interface RoundStat {
  round: number;
  socketMs: number;
  ptyMs: number;
  socketComplete: number;
  ptyComplete: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

async function runSocketSide(): Promise<{ roundLatencies: number[]; completeCounts: number[] }> {
  const roundLatencies: number[] = [];
  const completeCounts: number[] = [];
  const basePid = 700000;
  const sockPaths: string[] = [];
  const keyPaths: string[] = [];
  const servers: ReturnType<typeof createServer>[] = [];
  const sessions: LiveSession[] = [];

  // Set up N fake messaging sockets + peer tokens.
  for (let i = 0; i < TARGETS; i++) {
    const pid = basePid + i;
    const sock = join(tmpdir(), `bench-sock-${pid}.sock`);
    const keyPath = join(SESSIONS_DIR, `${pid}.bench.key`);
    sockPaths.push(sock);
    keyPaths.push(keyPath);
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(keyPath, JSON.stringify({ peerToken: "bench-token" }), "utf8");
    await rm(sock, { force: true });

    const server = createServer();
    servers.push(server);
    const session: LiveSession = {
      pid,
      sessionId: `bench-${i}`,
      cwd: "/tmp",
      messagingSocketPath: sock,
      name: `bench-${i}`,
      status: "idle",
    } as LiveSession;
    sessions.push(session);

    // Per-round receive tracking; replaced each round.
    let currentResolve: ((ts: number) => void) | null = null;
    let currentReceived = false;
    let buf = "";

    server.on("connection", (conn) => {
      buf = "";
      conn.on("data", (c) => {
        buf += c.toString("utf8");
        const lines = buf.split("\n");
        // Keep last partial.
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj?.type === "user" && obj?.message?.content === MESSAGE.trim()) {
              if (!currentReceived) {
                currentReceived = true;
                currentResolve?.(performance.now());
              }
            }
          } catch {
            // ignore non-JSON
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    // Store hooks on session object for round control.
    (session as any).__resetRound = () => {
      currentReceived = false;
      buf = "";
    };
    (session as any).__setResolve = (r: (ts: number) => void) => {
      currentResolve = r;
    };
    (session as any).__isReceived = () => currentReceived;
  }

  for (let round = 0; round < ROUNDS; round++) {
    // reset
    for (const s of sessions) {
      (s as any).__resetRound();
      (s as any).__receivedTs = null;
    }
    const roundStart = performance.now();
    const receivePromises = sessions.map((s) => {
      return new Promise<number>((resolve) => {
        (s as any).__setResolve((ts: number) => resolve(ts));
        // Fallback timeout
        setTimeout(() => resolve(roundStart + 5000), 5000);
      });
    });
    // fire deliveries
    await Promise.all(sessions.map((s) => deliver(s, MESSAGE, `bench-${round}-${s.pid}`)));
    const receives = await Promise.all(receivePromises);
    const maxReceive = Math.max(...receives);
    roundLatencies.push(maxReceive - roundStart);
    completeCounts.push(receives.filter((ts) => ts - roundStart < 4999).length);
  }

  // cleanup
  for (const srv of servers) srv.close();
  for (const sock of sockPaths) await rm(sock, { force: true });
  for (const kp of keyPaths) await rm(kp, { force: true });

  return { roundLatencies, completeCounts };
}

async function runPtySide(): Promise<{ roundLatencies: number[]; completeCounts: number[] }> {
  const roundLatencies: number[] = [];
  const completeCounts: number[] = [];
  const readerFile = join(tmpdir(), "bench-pty-reader.js");
  await writeFile(
    readerFile,
    "let b='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{b+=d;if(b.indexOf('<<<END>>>')>=0){process.stdout.write('DONE:'+process.argv[2]+'\\n');process.exit(0);}});process.stdin.resume();\n",
    "utf8",
  );

  const inFile = join(tmpdir(), "bench-pty-input.txt");
  await writeFile(inFile, MESSAGE + "\n" + END_MARKER + "\n", "utf8");
  for (let round = 0; round < ROUNDS; round++) {
    const procs: ReturnType<typeof spawn>[] = [];
    const donePromises: Promise<number>[] = [];
    const roundStart = performance.now();

    for (let i = 0; i < TARGETS; i++) {
      const proc = spawn("/bin/bash", ["-c", `cat ${inFile} | /usr/bin/script -q /dev/null bash -c 'stty raw -echo; exec node ${readerFile} ${i}'`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      procs.push(proc);
      const idx = i;
      const donePromise = new Promise<number>((resolve) => {
        let buf = "";
        proc.stdout.on("data", (c) => {
          buf += c.toString("utf8");
          if (buf.includes(`DONE:${idx}`)) resolve(performance.now());
        });
        proc.on("exit", () => {
          if (!buf.includes(`DONE:${idx}`)) resolve(roundStart + 30000);
        });
        setTimeout(() => resolve(roundStart + 30000), 30000);
      });
      donePromises.push(donePromise);
    }

    // Give PTYs a moment to start.
    await new Promise((r) => setTimeout(r, 200));

    // Send the message to all targets concurrently.
    const payload = MESSAGE + "\n" + END_MARKER + "\n";
    for (const proc of procs) {
      try {
        proc.stdin.write(payload);
        proc.stdin.end();
      } catch {
        // ignore
      }
    }

    const dones = await Promise.all(donePromises);
    const maxDone = Math.max(...dones);
    roundLatencies.push(maxDone - roundStart);
    completeCounts.push(dones.filter((ts) => ts - roundStart < 29999).length);

    // cleanup
    for (const proc of procs) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return { roundLatencies, completeCounts };
}

function summarize(latencies: number[], completes: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const totalTargets = TARGETS * ROUNDS;
  const totalComplete = completes.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    completeRate: totalComplete / totalTargets,
    totalComplete,
    totalTargets,
  };
}

async function main() {
  console.log(`# Transport Benchmark — targets=${TARGETS} rounds=${ROUNDS}`);
  console.log("");
  console.log("Message length:", MESSAGE.length, "chars (incl. Chinese, multiline, backticks)");
  console.log("");

  console.log("Running socket side...");
  const socket = await runSocketSide();
  console.log("Running PTY side...");
  const pty = await runPtySide();

  const s = summarize(socket.roundLatencies, socket.completeCounts);
  const p = summarize(pty.roundLatencies, pty.completeCounts);

  console.log("");
  console.log("| Transport | p50 (ms) | p95 (ms) | min (ms) | max (ms) | complete |");
  console.log("|---|---:|---:|---:|---:|---:|");
  console.log(`| socket (use-code-cli) | ${s.p50.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.min.toFixed(1)} | ${s.max.toFixed(1)} | ${s.totalComplete}/${s.totalTargets} (${(s.completeRate * 100).toFixed(1)}%) |`);
  console.log(`| PTY (script) | ${p.p50.toFixed(1)} | ${p.p95.toFixed(1)} | ${p.min.toFixed(1)} | ${p.max.toFixed(1)} | ${p.totalComplete}/${p.totalTargets} (${(p.completeRate * 100).toFixed(1)}%) |`);
  console.log("");
  console.log("Per-round socket (ms):", socket.roundLatencies.map((x) => x.toFixed(1)).join(", "));
  console.log("Per-round PTY (ms):", pty.roundLatencies.map((x) => x.toFixed(1)).join(", "));
  console.log("");
  console.log("Note: measures transport delivery only — not model inference. Socket side uses real deliver() path to fake messaging sockets; PTY side uses /usr/bin/script with raw mode.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
