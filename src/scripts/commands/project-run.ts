import type { CLICommand } from "modality-cli-kit";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  ProjectRunArgsSchema,
  projectRunErrorStatus,
  resolveProject,
  type ProjectRunArgs,
} from "../../lib/project-run";
import { spawnPty, registerJob, backgroundLogPath, liveJobCount, MAX_LIVE_JOBS, cleanEnv } from "../../lib/pty";

function detachedResult(cwd: string, jobId: string, pid: number, log: string) {
  return {
    success: true as const,
    background: true as const,
    message: `Started in background\nPID: ${pid}\nLog: ${log}\njobId: ${jobId}`,
    data: { cwd, background: true, jobId, pid, log },
  };
}

async function projectRun(args: ProjectRunArgs) {
  const targetRaw = args.project ?? args.target;
  const resolved = await resolveProject(targetRaw);
  if (!resolved.ok) {
    return {
      success: false,
      message: resolved.message,
      data: { statusCode: projectRunErrorStatus(resolved.message) },
    };
  }
  const proj = resolved.proj;

  const command = (args.cmd ?? "").trim();
  if (!command) {
    return {
      success: false,
      message: "Command required. Usage: use-code-cli project-run [project] -- <command>",
      data: { statusCode: 400 },
    };
  }

  if (liveJobCount() >= MAX_LIVE_JOBS) {
    return {
      success: false,
      message: "too many live jobs; wait for one to finish",
      data: { statusCode: 429 },
    };
  }

  if (args.detach) {
    const logPath = backgroundLogPath();
    const startedAt = Date.now();

    const serverOwned =
      args.keepAlive === true ||
      args.detachOwner === "server" ||
      args.detachOwner === "web" ||
      args.detachOwner === "keepalive";

    if (serverOwned) {
      const queue: Uint8Array[] = [];
      let headerDone = false;

      const proc = spawnPty(command, proj.cwd, (data) => {
        if (headerDone) {
          try { appendFileSync(logPath, Buffer.from(data)); } catch { /* ignore */ }
        } else {
          queue.push(data);
        }
      });

      const jobId = await registerJob(proc, logPath, { cwd: proj.cwd, command, background: true });

      const header =
        `Command: ${command}\n` +
        `Cwd: ${proj.cwd}\n` +
        `JobId: ${jobId}\n` +
        `StartedAt: ${new Date(startedAt).toISOString()}\n` +
        `---\n`;
      writeFileSync(logPath, header);
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        try { appendFileSync(logPath, Buffer.from(chunk)); } catch { /* ignore */ }
      }
      headerDone = true;

      try { proc.terminal.unref(); } catch { /* ignore */ }
      proc.unref();

      await Bun.sleep(150);

      return detachedResult(proj.cwd, jobId, proc.pid, logPath);
    }

    const header =
      `Command: ${command}\n` +
      `Cwd: ${proj.cwd}\n` +
      `StartedAt: ${new Date(startedAt).toISOString()}\n` +
      `---\n`;
    writeFileSync(logPath, header);

    const proc = Bun.spawn(["script", "-q", "-a", logPath, "bash", "-lic", command], {
      cwd: proj.cwd,
      env: cleanEnv(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    try { proc.unref(); } catch { /* ignore */ }

    const jobId = await registerJob(proc, logPath, { cwd: proj.cwd, command, background: true });
    try { appendFileSync(logPath, `JobId: ${jobId}\n`); } catch { /* log write failure is non-fatal */ }

    return detachedResult(proj.cwd, jobId, proc.pid, logPath);
  }

  const chunks: Uint8Array[] = [];
  const proc = spawnPty(command, proj.cwd, (data) => {
    chunks.push(data);
  });
  const jobId = await registerJob(proc, undefined, { cwd: proj.cwd, command, background: false });
  const code = await proc.exited;
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString();

  const message = `${text}\n[exit code: ${code ?? 0}]\n`;

  return {
    success: code === 0,
    message,
    data: { cwd: proj.cwd, jobId, exitCode: code ?? 0 },
  };
}

export const projectRunCommand: CLICommand = {
  name: "project-run",
  aliases: ["project-exec", "run-project"],
  description: "Run a shell command in a resolved project's working directory",
  inputSchema: ProjectRunArgsSchema,
  positionalKeys: ["target"],
  execute: projectRun,
  examples: [
    "use-code-cli project-run /w/proj -- ls -la",
    "use-code-cli project-run --project /w/proj -- echo hello",
    "use-code-cli project-run /w/proj \"echo hello\"",
  ],
};
