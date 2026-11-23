import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { getJob } from "../../lib/pty";

const PtyInputArgsSchema = z.object({
  jobId: z.string().min(1).describe("PTY job id"),
  data: z.string().describe("Keystrokes/data to write to the job terminal"),
});

type PtyInputArgs = z.infer<typeof PtyInputArgsSchema>;

async function ptyInput(args: PtyInputArgs) {
  const jobId = String(args.jobId || "").trim();
  const data = args.data;
  if (!jobId || typeof data !== "string") {
    return { success: false, message: "missing jobId or data", data: { statusCode: 400 } };
  }
  if (data.length > 65_536) {
    return { success: false, message: "data too large", data: { statusCode: 413 } };
  }
  const job = getJob(jobId);
  if (!job) {
    return { success: false, message: "job not found or already exited", data: { statusCode: 404 } };
  }
  if (!job.proc.terminal) {
    return { success: false, message: "job does not accept terminal input", data: { statusCode: 400 } };
  }
  try {
    job.proc.terminal.write(data);
    return { success: true, message: "ok", data: { statusCode: 200 } };
  } catch (e) {
    return { success: false, message: String(e), data: { statusCode: 500 } };
  }
}

export const ptyInputCommand: CLICommand = {
  name: "pty-input",
  aliases: ["pty-input"],
  description: "Send keystrokes to a live PTY job",
  inputSchema: PtyInputArgsSchema,
  execute: ptyInput,
};
