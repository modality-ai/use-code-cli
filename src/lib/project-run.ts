import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { describeProjects, findProject, readProjects, type ProjectInfo } from "./projects";
import { encodeProjectDir } from "./sessions";

export const ProjectRunArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Project workspace path, directory name, or unique path suffix; defaults to the current working directory",
    ),
  project: z
    .string()
    .optional()
    .describe("Project workspace path, directory name, or unique path suffix (default: current working directory)"),
  cmd: z
    .string()
    .min(1)
    .optional()
    .describe("Shell command to run in the resolved project cwd"),
  detach: z
    .boolean()
    .optional()
    .default(false)
    .describe("Run the command in the background (detach), mirroring the web Run in background"),
  keepAlive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Keep the spawnPty logger alive (web/server-owned detach); CLI-owned detach uses script recorder"),
  detachOwner: z
    .string()
    .optional()
    .describe("Who owns the detach: 'server'/'web'/'keepalive' keeps spawnPty; 'cli' (default) uses script recorder"),
});

export type ProjectRunArgs = z.infer<typeof ProjectRunArgsSchema>;

export function projectRunErrorStatus(message: string): number {
  if (message.includes("Command required")) return 400;
  if (message.includes("too many live jobs")) return 429;
  if (message.includes("ambiguous")) return 409;
  if (message.includes("No project matches")) return 404;
  return 500;
}

export async function resolveProject(
  targetRaw: string | undefined,
  deps?: { readProjects?: () => Promise<ProjectInfo[]> },
): Promise<
  | { ok: true; proj: ProjectInfo }
  | { ok: false; message: string }
> {
  const projects = await (deps?.readProjects ?? readProjects)();
  const target = (targetRaw ?? process.cwd()).replace(/\/+$/, "");
  const matches = findProject(projects, target);

  if (matches.length > 1) {
    return {
      ok: false,
      message: `"${targetRaw ?? target}" is ambiguous; use a full path:\n${describeProjects(matches)}`,
    };
  }

  let proj: ProjectInfo | undefined = matches[0];
  if (!proj) {
    const candidate = resolve(target);
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) {
          proj = {
            dir: encodeProjectDir(candidate),
            cwd: candidate,
            sessions: 0,
            updatedAt: 0,
          };
        }
      } catch {}
    }
    if (!proj) {
      return {
        ok: false,
        message: `No project matches "${targetRaw ?? target}".\nRun \`use-code-cli projects\` to see the available projects.`,
      };
    }
  }

  return { ok: true, proj };
}
