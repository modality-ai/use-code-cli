import { readSessions, type SessionInfo } from "./sessions";
import { sameProject } from "./session-create";

export interface WaitForSpawnedSessionInput {
  expectedId: string;
  projectCwd: string;
  projectDir: string;
  timeoutMs?: number;
  logPath?: string;
  readSessions?: (includeOffline: boolean) => Promise<SessionInfo[]>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
}

export interface WaitForSpawnedSessionResult {
  success: boolean;
  session?: SessionInfo;
  message?: string;
  logPath?: string;
}

export async function waitForSpawnedSession(
  input: WaitForSpawnedSessionInput,
): Promise<WaitForSpawnedSessionResult> {
  const timeoutMs = input.timeoutMs ?? 15000;
  const pollIntervalMs = input.pollIntervalMs ?? 100;
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const read = input.readSessions ?? ((inc: boolean) => readSessions(inc));

  const start = now();
  const deadline = start + timeoutMs;
  let iterations = 0;
  let lastNow = start;
  while (iterations < 10000) {
    iterations += 1;
    const sessions = await read(true);
    const match = sessions.find(
      (s) => s.sessionId === input.expectedId && sameProject(s, input.projectCwd, input.projectDir),
    );
    if (match) {
      return { success: true, session: match, logPath: input.logPath };
    }
    const currentNow = now();
    if (currentNow >= deadline) {
      break;
    }
    await sleep(pollIntervalMs);
    const nextNow = now();
    if (nextNow <= currentNow && nextNow <= lastNow) {
      break;
    }
    lastNow = nextNow;
  }

  return {
    success: false,
    message: `Timed out waiting for spawned session ${input.expectedId} after ${timeoutMs}ms`,
    logPath: input.logPath,
  };
}
