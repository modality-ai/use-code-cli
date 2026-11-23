import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { ProjectRunArgsSchema, projectRunErrorStatus, resolveProject, type ProjectRunArgs } from "../../lib/project-run";
import { spawnPty, registerJob, liveJobCount, MAX_LIVE_JOBS } from "../../lib/pty";

async function projectRunStream(args: ProjectRunArgs) {
  const resolved = await resolveProject(args.project ?? args.target);
  if (!resolved.ok) {
    return { success: false, message: resolved.message, data: { statusCode: projectRunErrorStatus(resolved.message) } };
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

  const pending: Uint8Array[] = [];
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const proc = spawnPty(command, proj.cwd, (data) => {
    if (controllerRef) {
      try { controllerRef.enqueue(data); } catch { /* stream gone */ }
    } else pending.push(data);
  });
  const jobId = await registerJob(proc, undefined, { cwd: proj.cwd, command, background: false });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const data of pending.splice(0)) controller.enqueue(data);
      const encoder = new TextEncoder();
      proc.exited.then((code) => {
        try { controller.enqueue(encoder.encode(`\n[exit code: ${code ?? 0}]\n`)); } catch { /* stream gone */ }
        try { controller.close(); } catch { /* stream gone */ }
      }).catch((err) => {
        try { controller.enqueue(encoder.encode(`\nError: ${err}\n`)); } catch { /* stream gone */ }
        try { controller.close(); } catch { /* stream gone */ }
      });
    },
  });

  return {
    success: true,
    message: "started",
    data: { cwd: proj.cwd, jobId, pid: proc.pid, stream },
  };
}

export const projectRunStreamCommand: CLICommand = {
  name: "project-run-stream",
  aliases: ["project-run-stream"],
  description: "Run a shell command in a resolved project's working directory with streaming PTY output",
  inputSchema: ProjectRunArgsSchema,
  positionalKeys: ["target"],
  execute: projectRunStream,
};
