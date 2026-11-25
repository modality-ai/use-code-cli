import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "../../lib/file-lock";
import type { ProjectInfo } from "../../lib/projects";
import { resolveProject } from "../../lib/project-run";
import { findExistingSession } from "../../lib/session-create";
import { spawnSession, type SpawnSessionInput, type SpawnSessionResult } from "../../lib/session-create-spawn";
import {
  waitForSpawnedSession,
  type WaitForSpawnedSessionInput,
  type WaitForSpawnedSessionResult,
} from "../../lib/session-create-verify";
import { readSessions } from "../../lib/sessions";

const SessionCreateArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .optional()
    .describe("Project workspace path, directory name, or unique path suffix; defaults to the current working directory"),
  project: z
    .string()
    .optional()
    .describe("Project workspace path, directory name, or unique path suffix (default: current working directory)"),
  name: z
    .string()
    .optional()
    .describe("Session name to create or reuse (required)"),
  id: z
    .string()
    .optional()
    .describe("Optional session id to reuse"),
  timeout: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Timeout in milliseconds (default: 15000)"),
});

export type SessionCreateArgs = z.infer<typeof SessionCreateArgsSchema>;

export interface SessionCreateDeps {
  resolveProject?: typeof resolveProject;
  findExistingSession?: typeof findExistingSession;
  readSessions?: typeof readSessions;
  readProjects?: () => Promise<ProjectInfo[]>;
  uuid?: () => string;
  spawnSession?: (input: SpawnSessionInput) => Promise<SpawnSessionResult>;
  waitForSpawnedSession?: (
    input: WaitForSpawnedSessionInput,
  ) => Promise<WaitForSpawnedSessionResult>;
}

export interface SessionCreateData {
  statusCode?: number;
  created?: boolean;
  sessionId?: string;
  name?: string;
  pid?: number;
  cwd?: string;
  online?: boolean;
  status?: string;
  logPath?: string;
}

export interface SessionCreateResult {
  success: boolean;
  message: string;
  data: SessionCreateData;
}

function errorResult(message: string): SessionCreateResult {
  return { success: false, message, data: { statusCode: 400 } };
}

async function sessionCreate(
  args: SessionCreateArgs,
  deps: SessionCreateDeps = {},
): Promise<SessionCreateResult> {
  const name = (args.name ?? "").trim();
  if (!name) {
    return errorResult("--name is required");
  }

  const id = args.id !== undefined ? args.id.trim() : undefined;
  if (args.id !== undefined && id === "") {
    return errorResult("--id must not be blank");
  }

  let timeout = 15000;
  if (args.timeout !== undefined) {
    const n = Number(args.timeout);
    if (!Number.isInteger(n) || n <= 0) {
      return errorResult("--timeout must be a positive integer (milliseconds)");
    }
    timeout = n;
  }
  const resolve = deps.resolveProject ?? resolveProject;
  const resolved = await resolve(args.project ?? args.target, deps.readProjects ? { readProjects: deps.readProjects } : undefined);
  if (!resolved.ok) {
    return {
      success: false,
      message: resolved.message,
      data: { statusCode: 404 },
    };
  }
  const proj = resolved.proj;
  const lockKey = createHash("sha256").update(`${proj.dir}\0${name}`).digest("hex");
  const lockFile = join(tmpdir(), `use-code-cli-session-create-${lockKey}.lock`);

  try {
    return await withLock(lockFile, async () => {
      const readForFind = deps.readSessions;
      const sessions = readForFind ? await readForFind(true) : undefined;
      const finder = deps.findExistingSession ?? findExistingSession;
      const found = await finder({
        projectCwd: proj.cwd,
        projectDir: proj.dir,
        name,
        id,
        sessions,
      });

      if (found.found) {
        const s = found.session!;
        const data = {
          created: false,
          sessionId: s.sessionId,
          name: s.name ?? name,
          pid: s.pid,
          cwd: s.cwd,
          online: s.online,
          status: s.status,
        };
        return {
          success: true,
          message: `Found existing session ${s.sessionId} (${s.name ?? name})`,
          data,
        };
      }

      if (found.reason === "id-conflict") {
        return {
          success: false,
          message: `Session id ${id} not found, but name "${name}" already exists under a different session id in this project`,
          data: { statusCode: 409 },
        };
      }

      const newId = id ?? (deps.uuid ? deps.uuid() : crypto.randomUUID());
      const spawner = deps.spawnSession ?? spawnSession;
      const spawnRes = await spawner({
        projectTarget: proj.cwd,
        name,
        id: newId,
      });

      if (!spawnRes?.success) {
        return {
          success: false,
          message: spawnRes?.message ?? "Failed to spawn session",
          data: { statusCode: 500, logPath: spawnRes?.logPath },
        };
      }

      const logPath = spawnRes.logPath;
      const verifier = deps.waitForSpawnedSession ?? waitForSpawnedSession;
      const verified = await verifier({
        expectedId: newId,
        projectCwd: proj.cwd,
        projectDir: proj.dir,
        timeoutMs: timeout,
        logPath,
        readSessions: deps.readSessions,
      });

      if (!verified?.success) {
        return {
          success: false,
          message: verified?.message ?? "Failed to verify spawned session",
          data: { statusCode: 500, logPath: verified?.logPath ?? logPath },
        };
      }

      const s = verified.session!;
      const data = {
        created: true,
        sessionId: s.sessionId,
        name: s.name ?? name,
        pid: s.pid,
        cwd: s.cwd,
        online: s.online,
        status: s.status,
        logPath,
      };
      return {
        success: true,
        message: `Created session ${s.sessionId} (${s.name ?? name})`,
        data,
      };
    });
  } catch (cause) {
    return {
      success: false,
      message: cause instanceof Error ? cause.message : String(cause),
      data: { statusCode: 409 },
    };
  }
}

export const sessionCreateCommand: CLICommand<SessionCreateDeps, SessionCreateArgs, SessionCreateResult> = {
  name: "session-create",
  description: "Create or reuse a session for a project",
  inputSchema: SessionCreateArgsSchema,
  positionalKeys: ["target"],
  execute: (args) => sessionCreate(args as SessionCreateArgs),
  create: (deps) => (args) => sessionCreate(args as SessionCreateArgs, deps),
  examples: [
    "use-code-cli session-create --name my-session",
    "use-code-cli session-create /w/proj --name my-session --id 123e4567-e89b-42d3-a456-426614174000",
  ],
};
