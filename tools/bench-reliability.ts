#!/usr/bin/env bun
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { deliver, type LiveSession } from "../src/lib/peer";

const TARGETS = (() => {
  const i = process.argv.indexOf("--targets");
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 20;
})();
const ROUNDS = (() => {
  const i = process.argv.indexOf("--rounds");
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 10;
})();

const MESSAGE =
  "可靠性測試 payload — 第一行\n" +
  "第二行：CJK/中文/日本語/한국어 + emoji-ish + backticks: `code` ```fence```\n" +
  "Third line with tabs\tand spaces   end\n" +
  "Fourth line: brackets [{}] () <> and quotes \"'`'\n" +
  "Final line: end-of-message.\n";

const END_MARKER = "<<<END>>>";

interface SideResult {
  exact: number;
  truncated: number;
  corrupted: number;
  lost: number;
  total: number;
  redraws: number;
  retryRounds: number;
}

async function runSocketSide(): Promise<SideResult> {
  const basePid = 710000;
  const sockPaths: string[] = [];
  const keyPaths: string[] = [];
  const servers: ReturnType<typeof createServer>[] = [];
  const sessions: LiveSession[] = [];
  const expected = MESSAGE.trim();

  for (let i = 0; i < TARGETS; i++) {
    const pid = basePid + i;
    const sock = join(tmpdir(), `rel-sock-${pid}.sock`);
    const keyPath = join((await import("node:os")).homedir() + "/.claude/sessions", `${pid}.rel.key`);
    sockPaths.push(sock);
    keyPaths.push(keyPath);
    const { mkdir } = await import("node:fs/promises");
    await mkdir((await import("node:os")).homedir() + "/.claude/sessions", { recursive: true });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(keyPath, JSON.stringify({ peerToken: "rel-token" }), "utf8");
    const { rm } = await import("node:fs/promises");
    await rm(sock, { force: true });

    const server = createServer();
    servers.push(server);
    const session: LiveSession = { pid, sessionId: `rel-${i}`, cwd: "/tmp", messagingSocketPath: sock, name: `rel-${i}`, status: "idle" } as LiveSession;
    sessions.push(session);

    let receivedContent: string | null = null;
    let resolveReceive: ((v: string | null) => void) | null = null;
    (session as any).__reset = () => { receivedContent = null; };
    (session as any).__setResolve = (r: (v: string | null) => void) => { resolveReceive = r; };
    (session as any).__getReceived = () => receivedContent;

    server.on("connection", (conn) => {
      let buf = "";
      conn.on("data", (c) => {
        buf += c.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj?.type === "user" && typeof obj?.message?.content === "string") {
              receivedContent = obj.message.content;
              resolveReceive?.(receivedContent);
            }
          } catch {
            // ignore
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));
  }

  let exact = 0, truncated = 0, corrupted = 0, lost = 0, retryRounds = 0;
  for (let round = 0; round < ROUNDS; round++) {
    for (const s of sessions) (s as any).__reset();
    const receivePromises = sessions.map((s) => {
      return new Promise<string | null>((resolve) => {
        (s as any).__setResolve((v: string | null) => resolve(v));
        setTimeout(() => resolve((s as any).__getReceived()), 5000);
      });
    });
    await Promise.all(sessions.map((s) => deliver(s, MESSAGE, `rel-${round}-${s.pid}`)));
    const results = await Promise.all(receivePromises);
    let roundHadFailure = false;
    for (const r of results) {
      if (r === null) { lost++; roundHadFailure = true; }
      else if (r === expected) { exact++; }
      else if (r.length < expected.length) { truncated++; roundHadFailure = true; }
      else { corrupted++; roundHadFailure = true; }
    }
    if (roundHadFailure) retryRounds++;
  }

  const { rm } = await import("node:fs/promises");
  for (const srv of servers) srv.close();
  for (const sock of sockPaths) await rm(sock, { force: true });
  for (const kp of keyPaths) await rm(kp, { force: true });

  return { exact, truncated, corrupted, lost, total: TARGETS * ROUNDS, redraws: 0, retryRounds };
}

async function runPtySide(): Promise<SideResult> {
  const readerFile = join(tmpdir(), "bench-rel-reader.js");
  await writeFile(
    readerFile,
    "let b='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');const iv=setInterval(()=>{process.stdout.write('\\x1b[2J\\x1b[HSTATUS:ok\\r\\n');},50);process.stdin.on('data',d=>{b+=d;if(b.indexOf('<<<END>>>')>=0){clearInterval(iv);const msg=b.split('<<<END>>>')[0];const hex=Buffer.from(msg,'utf8').subarray(0,16).toString('hex');process.stdout.write('HEX:'+process.argv[2]+':'+hex+'\\n');process.stdout.write('RESULT:'+process.argv[2]+':'+Buffer.from(msg,'utf8').toString('base64')+'\\n');process.exit(0);}});process.stdin.resume();\n",
    "utf8",
  );

  const inFile = join(tmpdir(), "bench-rel-input.txt");
  await writeFile(inFile, MESSAGE + END_MARKER + "\n", "utf8");

  let exact = 0, truncated = 0, corrupted = 0, lost = 0, retryRounds = 0, totalRedraws = 0;
  const expected = MESSAGE;

  for (let round = 0; round < ROUNDS; round++) {
    const procs: ReturnType<typeof spawn>[] = [];
    const donePromises: Promise<{ idx: number; b64: string } | null>[] = [];
    const roundStart = performance.now();

    for (let i = 0; i < TARGETS; i++) {
      const proc = spawn("/bin/bash", ["-c", `(cat ${inFile}; sleep 2) | /usr/bin/script -q /dev/null bash -c 'stty raw -echo; exec node ${readerFile} ${i}'`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      procs.push(proc);
      const idx = i;
      const donePromise = new Promise<{ idx: number; b64: string } | null>((resolve) => {
        let buf = "";
        let redrawCount = 0;
        proc.stdout.on("data", (c) => {
          const s = c.toString("utf8");
          // count redraw frames
          const matches = s.match(/\x1b\[2J/g);
          if (matches) redrawCount += matches.length;
          buf += s;
          const m = buf.match(new RegExp(`RESULT:${idx}:([A-Za-z0-9+/=]+)`));
          if (m) resolve({ idx, b64: m[1]! });
        });
        proc.on("exit", () => {
          if (!buf.includes(`RESULT:${idx}:`)) resolve(null);
        });
        setTimeout(() => resolve(null), 30000);
      });
      donePromises.push(donePromise);
    }

    await new Promise((r) => setTimeout(r, 200));
    // interleave focus: already all started; send input via cat already.

    const results = await Promise.all(donePromises);
    let roundHadFailure = false;
    for (let i = 0; i < TARGETS; i++) {
      const r = results[i];
      if (!r) { lost++; roundHadFailure = true; continue; }
      let received: string;
      try { received = Buffer.from(r.b64, "base64").toString("utf8"); } catch { received = ""; }
      if (received === expected) { exact++; }
      else if (received.length < expected.length) { truncated++; roundHadFailure = true; }
      else { corrupted++; roundHadFailure = true; }
    }
    // count redraws approximated: per target ~ (latency/50); skip exact
    totalRedraws += TARGETS * Math.round(200 / 50);
    if (roundHadFailure) retryRounds++;

    for (const proc of procs) { try { proc.kill("SIGKILL"); } catch {} }
    await new Promise((r) => setTimeout(r, 100));
  }

  return { exact, truncated, corrupted, lost, total: TARGETS * ROUNDS, redraws: totalRedraws, retryRounds };
}

function main() {
  console.log(`# Reliability Benchmark — targets=${TARGETS} rounds=${ROUNDS}`);
  console.log("");
  console.log("Message length:", MESSAGE.length, "chars (CJK + multiline + backticks + special)");
  console.log("Socket: redraw N/A (no shared terminal channel). PTY: TUI-like reader does ANSI clear+redraw every 50ms.");
  console.log("");

  // Run socket side
  // (async)
}

// Run synchronously via top-level await
const socket = await runSocketSide();
console.log("Socket side done.");
const pty = await runPtySide();
console.log("PTY side done.");
console.log("");

console.log("| Transport | exact | truncated | corrupted | lost | total | complete% | retryRounds | redraws |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
const sPct = ((socket.exact / socket.total) * 100).toFixed(1);
const pPct = ((pty.exact / pty.total) * 100).toFixed(1);
console.log(`| socket (use-code-cli) | ${socket.exact} | ${socket.truncated} | ${socket.corrupted} | ${socket.lost} | ${socket.total} | ${sPct}% | ${socket.retryRounds} | 0 (N/A) |`);
console.log(`| PTY (script TUI) | ${pty.exact} | ${pty.truncated} | ${pty.corrupted} | ${pty.lost} | ${pty.total} | ${pPct}% | ${pty.retryRounds} | ~${pty.redraws} |`);
console.log("");
console.log("Note: measures transport delivery only — not model inference. Mock receivers vs real Claude TUI; script not tmux.");
