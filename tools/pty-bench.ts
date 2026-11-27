#!/usr/bin/env bun
// Standalone PTY registry/spawn benchmark; not part of `bun test`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { getJob, listJobs, registerJob, spawnPty, type PtyProc } from "../src/lib/pty";

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const JOBS = option("jobs", 100);
const MB = option("mb", 10);
const SPAWNS = option("spawns", 20);
const BASELINE = process.argv.includes("--baseline");

const benchHome = mkdtempSync(join(tmpdir(), "pty-bench-"));
process.env.HOME = benchHome;

interface FakeJob {
  proc: PtyProc;
  exit: (code: number) => void;
}

function fakeJob(pid: number): FakeJob {
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
  const proc = { pid, exitCode: null, exited } as unknown as PtyProc;
  return { proc, exit: (code) => resolveExit(code) };
}

function ms(value: number): string {
  return value.toFixed(2);
}

async function benchSpawn(label: string, fast: boolean): Promise<void> {
  const argv = ["true"];
  const spawn = () => fast
    ? spawnPty("true", benchHome, undefined, { fast: true, argv })
    : spawnPty("true", benchHome);
  await (await spawn()).exited; // shell startup warmup

  const start = performance.now();
  for (let i = 0; i < SPAWNS; i++) await (await spawn()).exited;
  const total = performance.now() - start;
  console.log(`  ${label.padEnd(16)} ${ms(total)} ms total | ${ms(total / SPAWNS)} ms/spawn`);
}

async function benchRegistry(): Promise<void> {
  const jobs = Array.from({ length: JOBS }, (_, i) => fakeJob(910000 + i));

  const startRegister = performance.now();
  let lastJobId = "";
  for (const job of jobs) {
    lastJobId = await registerJob(job.proc, undefined, { spawnMode: "shell", cwd: benchHome, command: "true" });
  }
  const registerMs = performance.now() - startRegister;

  const startExit = performance.now();
  for (const job of jobs) job.exit(0);
  // Reads force pending persistence work to land, so exit codes are visible.
  await listJobs();
  const exitMs = performance.now() - startExit;

  console.log(`register/exit (${JOBS} jobs)`);
  console.log(`  register total ${ms(registerMs)} ms | ${ms(registerMs / JOBS)} ms/job`);
  console.log(`  exit     total ${ms(exitMs)} ms | ${ms(exitMs / JOBS)} ms/job`);
  console.log(`  last job in memory: ${getJob(lastJobId) === undefined ? "evicted" : "present"}`);
}

interface OutputOptions {
  fast?: boolean;
  argv?: string[];
  batchOutput?: boolean;
}

async function benchOutput(label: string, opts: OutputOptions): Promise<void> {
  const bytes = MB * 1024 * 1024;
  const command = `head -c ${bytes} /dev/zero`;
  let received = 0;
  let callbacks = 0;

  const proc = spawnPty(command, benchHome, (data) => {
    received += data.length;
    callbacks += 1;
  }, opts);
  const start = performance.now();
  const code = await proc.exited;
  const elapsedMs = performance.now() - start;

  console.log(`  ${label.padEnd(16)} ${(bytes / 1024 / 1024 / (elapsedMs / 1000)).toFixed(2)} MB/s | ${ms(elapsedMs)} ms | ${callbacks} callbacks | ${received} bytes | exit ${code ?? "none"}`);
}

try {
  console.log(`PTY micro-benchmark: ${JOBS} jobs, ${SPAWNS} spawns, ${MB} MB output`);
  console.log("spawn latency");
  await benchSpawn("shell", false);
  if (!BASELINE) await benchSpawn("fast", true);
  await benchRegistry();
  console.log(`output throughput (${MB} MB via PTY)`);
  await benchOutput(BASELINE ? "shell(unbatched)" : "shell+batched", { batchOutput: !BASELINE });
  if (!BASELINE) {
    await benchOutput("shell+unbatch", { batchOutput: false });
    await benchOutput("fast+batched", { fast: true, argv: ["head", "-c", String(MB * 1024 * 1024), "/dev/zero"], batchOutput: true });
    await benchOutput("fast+unbatch", { fast: true, argv: ["head", "-c", String(MB * 1024 * 1024), "/dev/zero"], batchOutput: false });
  }
} finally {
  // Land any queued writes before removing the temporary HOME.
  await listJobs();
  rmSync(benchHome, { recursive: true, force: true });
}
