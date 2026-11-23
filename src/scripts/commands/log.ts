import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { listJobs } from "../../lib/pty";

const LogArgsSchema = z.object({
  target: z.string().min(1).describe("Job id or log file path"),
});

type LogArgs = z.infer<typeof LogArgsSchema>;

async function log(args: LogArgs) {
  const target = String(args.target || "").trim();
  if (!target) return { success: false, message: "target required" };

  let logPath: string | undefined;
  let jobId: string | undefined;

  if (existsSync(target)) {
    logPath = target;
  } else {
    const jobs = await listJobs();
    const job = jobs.find((j) => j.jobId === target);
    if (!job) return { success: false, message: `Unknown job: ${target}` };
    jobId = job.jobId;
    logPath = job.log;
  }

  if (!logPath || !existsSync(logPath)) {
    return { success: false, message: `No log available for ${target}` };
  }

  const content = readFileSync(logPath, "utf8");
  return {
    success: true,
    message: content,
    data: { jobId, path: logPath, content },
  };
}

export const logCommand: CLICommand = {
  name: "log",
  aliases: ["log"],
  description: "Show the log of a background PTY job or a log file",
  inputSchema: LogArgsSchema,
  positionalKeys: ["target"],
  execute: log,
};
