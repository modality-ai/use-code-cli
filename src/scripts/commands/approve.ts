import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { listJobs, writeJobApproval } from "../../lib/pty";
import {
  BLIND_CONSENT_REQUIRED,
  isPermissionPromptWaiting,
  NOT_APPROVABLE,
} from "../../lib/permission-prompt";
import { readSessions, type SessionInfo } from "../../lib/sessions";

const ApproveArgsSchema = z.object({
  jobId: z.string().min(1).describe("PTY job id of the session waiting on a permission prompt"),
  blind: z
    .boolean()
    .optional()
    .default(false)
    .describe("Confirm you verified the target with `sessions --waiting` before sending a blind keystroke"),
});

type ApproveArgs = z.infer<typeof ApproveArgsSchema>;

type ListJobs = typeof listJobs;
type ReadSessions = (includeOffline?: boolean) => Promise<SessionInfo[]>;
type WriteApproval = typeof writeJobApproval;

export interface ApproveDeps {
  listJobs?: ListJobs;
  readSessions?: ReadSessions;
  writeApproval?: WriteApproval;
}

function refuse(statusCode: number) {
  return { success: false, message: NOT_APPROVABLE, data: { statusCode } };
}

async function approve(args: ApproveArgs, deps?: ApproveDeps) {
  const jobId = String(args?.jobId ?? "").trim();
  if (!jobId) {
    return { success: false, message: "missing jobId", data: { statusCode: 400 } };
  }
  if (args?.blind !== true) {
    return { success: false, message: BLIND_CONSENT_REQUIRED, data: { statusCode: 400 } };
  }

  // The owning process may be a different CLI process or the web server, so
  // approval goes through the job's control socket, not the local job registry.
  const jobs = await (deps?.listJobs ?? listJobs)();
  const job = jobs.find((j) => j.jobId === jobId && j.approvable);
  if (!job?.controlPath) return refuse(404);
  const controlPath = job.controlPath;

  const sessions = await (deps?.readSessions ?? readSessions)(false);
  const waiting = sessions.some(
    (s) => s.pid === job.pid && s.online !== false && isPermissionPromptWaiting(s),
  );
  if (!waiting) return refuse(404);

  const sent = await (deps?.writeApproval ?? writeJobApproval)(controlPath);
  if (!sent) return refuse(404);
  return { success: true, message: "ok", data: { statusCode: 200, jobId } };
}

export const approveCommand: CLICommand<ApproveDeps, ApproveArgs, any> = {
  name: "approve",
  aliases: ["approve"],
  description:
    "Send y\\r to a permission prompt in a use-code-cli PTY job (requires --blind confirmation)",
  inputSchema: ApproveArgsSchema,
  positionalKeys: ["jobId"],
  execute: (args) => approve(args as ApproveArgs),
  create: (deps) => (args) => approve(args as ApproveArgs, deps),
  examples: [
    "use-code-cli sessions --waiting",
    "use-code-cli approve pty-1-12345 --blind",
  ],
};
