#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");

interface TestResult {
  file: string;
  duration: number;
  testCount: number;
  status: "PASS" | "FAIL";
}

function findTestFiles(dir: string, results: string[] = []): string[] {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      findTestFiles(filePath, results);
    } else if (file.endsWith(".test.ts") || file.endsWith(".test.js")) {
      results.push(filePath);
    }
  }

  return results;
}

async function measureTestFile(testFile: string): Promise<TestResult> {
  const start = performance.now();

  return new Promise<TestResult>((resolve) => {
    const child = spawn("bun", ["test", testFile], {
      stdio: "pipe",
      cwd: REPO_ROOT,
    });

    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("close", (code: number | null) => {
      const end = performance.now();
      const duration = end - start;

      const lines = output.split("\n");
      let testCount = 0;
      for (const line of lines) {
        if (line.includes("pass") || line.includes("fail")) {
          const match = line.match(/(\d+)\s+pass/);
          if (match) {
            testCount = parseInt(match[1] ?? "0", 10);
            break;
          }
        }
      }

      resolve({
        file: path.relative(REPO_ROOT, testFile),
        duration: Math.round(duration),
        testCount,
        status: code === 0 ? "PASS" : "FAIL",
      });
    });
  });
}

async function main(): Promise<void> {
  const testFiles = findTestFiles(SRC_DIR);

  console.log(`Found ${testFiles.length} test files. Measuring performance...\n`);

  const results: TestResult[] = [];

  for (const testFile of testFiles) {
    const result = await measureTestFile(testFile);
    results.push(result);
    console.log(`✓ ${result.file} - ${result.duration}ms (${result.testCount || 0} tests)`);
  }

  console.log("\n=== TOP 10 SLOWEST TEST FILES ===\n");

  results
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)
    .forEach((result, index) => {
      const fileName = result.file.split("/").pop();
      console.log(`${index + 1}. ${fileName}`);
      console.log(`   Duration: ${result.duration}ms`);
      console.log(`   Tests: ${result.testCount || 0}`);
      console.log(`   Path: ${result.file}`);
      console.log("");
    });
}

main().catch(console.error);