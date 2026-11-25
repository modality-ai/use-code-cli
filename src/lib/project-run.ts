import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  backgroundLogPath,
  cleanEnv,
  liveJobCount,
  MAX_LIVE_JOBS,
  registerJob,
  spawnPty,
} from "./pty";
import { describeProjects, findProject, readProjects, type ProjectInfo } from "./projects";
import { encodeProjectDir } from "./sessions";

export const ProjectRunArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Project workspace path, directory name, or unique path suffix; defaults to the current working directory",
    ),
  project: z
    .string()
    .optional()
    .describe("Project workspace path, directory name, or unique path suffix (default: current working directory)"),
  cmd: z
    .string()
    .min(1)
    .optional()
    .describe("Shell command to run in the resolved project cwd"),
  detach: z
    .boolean()
    .optional()
    .default(false)
    .describe("Run the command in the background (detach), mirroring the web Run in background"),
  keepAlive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Keep the spawnPty logger alive (web/server-owned detach); CLI-owned detach uses script recorder"),
  detachOwner: z
    .string()
    .optional()
    .describe("Who owns the detach: 'server'/'web'/'keepalive' keeps spawnPty; 'cli' (default) uses script recorder"),
});

export type ProjectRunArgs = z.infer<typeof ProjectRunArgsSchema>;

function detachedResult(cwd: string, jobId: string, pid: number, log: string) {
  return {
    success: true as const,
    background: true as const,
    message: `Started in background\nPID: ${pid}\nLog: ${log}\njobId: ${jobId}`,
    data: { cwd, background: true, jobId, pid, log },
  };
}

export async function runProjectCommand(args: ProjectRunArgs) {
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

export function projectRunErrorStatus(message: string): number {
  if (message.includes("Command required")) return 400;
  if (message.includes("too many live jobs")) return 429;
  if (message.includes("ambiguous")) return 409;
  if (message.includes("No project matches")) return 404;
  return 500;
}

export async function resolveProject(
  targetRaw: string | undefined,
  deps?: { readProjects?: () => Promise<ProjectInfo[]> },
): Promise<
  | { ok: true; proj: ProjectInfo }
  | { ok: false; message: string }
> {
  const projects = await (deps?.readProjects ?? readProjects)();
  const target = (targetRaw ?? process.cwd()).replace(/\/+$/, "");
  const matches = findProject(projects, target);

  if (matches.length > 1) {
    return {
      ok: false,
      message: `"${targetRaw ?? target}" is ambiguous; use a full path:\n${describeProjects(matches)}`,
    };
  }

  let proj: ProjectInfo | undefined = matches[0];
  if (!proj) {
    const candidate = resolve(target);
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) {
          proj = {
            dir: encodeProjectDir(candidate),
            cwd: candidate,
            sessions: 0,
            updatedAt: 0,
          };
        }
      } catch {}
    }
    if (!proj) {
      return {
        ok: false,
        message: `No project matches "${targetRaw ?? target}".\nRun \`use-code-cli projects\` to see the available projects.`,
      };
    }
  }

  return { ok: true, proj };
}
