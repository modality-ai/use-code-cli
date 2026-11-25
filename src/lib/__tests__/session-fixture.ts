import { encodeProjectDir } from "../sessions";
import type { SessionInfo } from "../sessions";

export const PROJECT_CWD = "/tmp/proj";
export const PROJECT_DIR = encodeProjectDir(PROJECT_CWD);

export function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 0,
    sessionId: "s1",
    cwd: PROJECT_CWD,
    startedAt: 1,
    updatedAt: 10,
    online: false,
    status: "offline",
    name: "demo",
    ...overrides,
  };
}
