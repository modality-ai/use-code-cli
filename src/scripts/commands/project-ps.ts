import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { listJobs } from "../../lib/pty";

const ProjectPsArgsSchema = z.object({});

async function projectPs() {
  const jobs = await listJobs();
  const lines = jobs.map(
    (j) => `${j.jobId}\t${j.pid}\t${j.status}\t${j.cwd ?? ""}\t${j.log ?? ""}`,
  );
  const message = jobs.length ? lines.join("\n") : "No background jobs.";
  return { success: true, message, data: jobs };
}

export const projectPsCommand: CLICommand = {
  name: "project-ps",
  aliases: ["project-ps"],
  description: "List known background PTY jobs",
  inputSchema: ProjectPsArgsSchema,
  execute: projectPs,
};
