import { runProjectCommand, type ProjectRunArgs } from "./project-run";

export interface BuildSpawnCommandInput {
  name: string;
  id: string;
  claudeBin: string;
}

export function buildSpawnCommand(input: BuildSpawnCommandInput): string {
  const quote = (value: string): string =>
    "'" + String(value).replace(/'/g, "'\\''") + "'";
  return `${quote(input.claudeBin)} --bg --name ${quote(input.name)} --session-id ${quote(input.id)}`;
}

export interface ProjectRunResponse {
  success?: boolean;
  message?: string;
  data?: { log?: string; logPath?: string; jobId?: string; pid?: number };
  result?: { log?: string; logPath?: string; jobId?: string; pid?: number };
}

export interface SpawnSessionInput {
  projectTarget: string;
  name: string;
  id: string;
  claudeBin?: string;
  which?: (bin: string) => string | null;
  projectRun?: (args: ProjectRunArgs) => Promise<ProjectRunResponse>;
}

export interface SpawnSessionResult {
  success: boolean;
  command?: string;
  logPath?: string;
  jobId?: string;
  pid?: number;
  message?: string;
}

export async function spawnSession(input: SpawnSessionInput): Promise<SpawnSessionResult> {
  const which = input.which ?? ((bin: string) => Bun.which(bin) ?? null);
  const claudeBin = input.claudeBin ?? which("claude");
  if (!claudeBin) {
    return { success: false, message: "claude binary not found on PATH" };
  }

  const command = buildSpawnCommand({ name: input.name, id: input.id, claudeBin });

  const runner = input.projectRun ?? runProjectCommand;

  const res = await runner({
    target: input.projectTarget,
    cmd: command,
    detach: true,
    detachOwner: "cli",
    keepAlive: false,
  });

  if (!res?.success) {
    return {
      success: false,
      command,
      message: res?.message ?? "failed to spawn session",
    };
  }

  const response = res as ProjectRunResponse;
  const data = response.data ?? response.result ?? {};
  return {
    success: true,
    command,
    logPath: data.log ?? data.logPath,
    jobId: data.jobId,
    pid: data.pid,
  };
}
