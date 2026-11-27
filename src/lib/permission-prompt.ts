export const NOT_APPROVABLE =
  "NOT APPROVABLE — this session was started outside use-code-cli's PTY (or has exited). " +
  "Approve it in that session's own terminal, or install a PermissionRequest hook / " +
  "launch with --permission-prompt-tool for automated approval.";

export const BLIND_CONSENT_REQUIRED =
  "BLIND CONSENT REQUIRED — pass --blind to confirm you verified the target with `sessions --waiting`.";

const PERMISSION_PROMPT =
  /\b(?:permission(?![\w-])\s+(?:prompt|request(?:ed)?|needed|required)|(?:awaiting|waiting\s+for)\s+permission(?![\w-])|(?:prompt|request(?:ing)?)\s+(?:for\s+)?permission(?![\w-]))\b/i;

/**
 * A session is only approvable when it is waiting specifically on a permission
 * prompt. Other waiting reasons may need a human at the keyboard, so fail closed.
 */
export function isPermissionPromptWaiting(s: {
  status?: string | null;
  waitingFor?: string | null;
}): boolean {
  if (s.status !== "waiting") return false;
  return PERMISSION_PROMPT.test(s.waitingFor ?? "");
}
