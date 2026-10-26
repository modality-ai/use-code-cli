import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { rm, stat } from "node:fs/promises";
import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import {
  forgetProjectConfig,
  type ForgetProjectResult,
} from "../../lib/claude-config";
import {
  describeProjects,
  encodeProjectDir,
  findProject,
  readProjects,
  type ProjectInfo,
} from "../../lib/projects";
import { PROJECTS_DIR, readSessions } from "../../lib/sessions";

const ProjectDeleteArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe(
      "Project workspace path, directory name, or unique path suffix; an existing folder works even with no transcripts",
    ),
  yes: z
    .boolean()
    .optional()
    .default(false)
    .describe("Delete the project without stopping at the confirmation gate"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Delete even when live sessions are running in the project"),
  "keep-config": z
    .boolean()
    .optional()
    .default(false)
    .describe("Keep the project's entry in Claude Code's config (trust is preserved)"),
  "dry-run": z
    .boolean()
    .optional()
    .default(false)
    .describe("Report what would be deleted, without deleting it"),
});

type ProjectDeleteArgs = z.infer<typeof ProjectDeleteArgsSchema>;

function sessions(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}

/** The trust-config outcome, worded for a real run or a dry run. */
function configNotes(
  result: ForgetProjectResult,
  forceActive: boolean,
): string {
  const lines: string[] = [];
  if (result.removed.length > 0) {
    lines.push(
      `${result.dryRun ? "Would reset" : "Reset"} trust config for ${result.removed.join(", ")} in ${result.configPath}.`,
    );
  } else {
    lines.push("No Claude Code trust config entry to reset.");
  }
  if (result.expiredAncestors.length > 0) {
    const keys = result.expiredAncestors.join(", ");
    lines.push(
      `${result.dryRun ? "Would clear" : "Cleared"} inherited trust for ${keys}; Claude Code will also ask there and in its other subfolders.`,
    );
  }
  if (forceActive) {
    lines.push(
      "Note: active sessions were overridden with --force; a running session may restore its config entry on exit.",
    );
  }
  return lines.join("\n");
}

async function projectDelete(args: ProjectDeleteArgs) {
  const projects = await readProjects();
  // Tolerate a trailing slash from a pasted path.
  const target = args.target.replace(/\/+$/, "");
  const matches = findProject(projects, target);

  if (matches.length > 1) {
    return {
      success: false,
      message: `"${args.target}" is ambiguous; use a full path:\n${describeProjects(matches)}`,
    };
  }

  let project: ProjectInfo | undefined = matches[0];
  if (!project) {
    // The transcripts may already be gone; still allow resetting the folder's
    // trust entry by pointing at the existing directory.
    const candidate = resolve(target);
    if (existsSync(candidate) && (await stat(candidate)).isDirectory()) {
      project = {
        dir: encodeProjectDir(candidate),
        cwd: candidate,
        sessions: 0,
        updatedAt: 0,
      };
    } else {
      return {
        success: false,
        message: `No project matches "${args.target}".\nRun \`use-code-cli projects\` to see the available projects.`,
      };
    }
  }

  const path = join(PROJECTS_DIR, project.dir);
  const active = (await readSessions(false)).filter((s) => s.cwd === project.cwd).length;
  const data = {
    dir: project.dir,
    cwd: project.cwd,
    sessions: project.sessions,
    active,
  };

  if (args["dry-run"]) {
    const activeNote =
      active > 0
        ? `\n${active} active session${active === 1 ? "" : "s"} run there; --force would be required.`
        : "";
    const configNote = args["keep-config"]
      ? "Trust config would be kept (--keep-config)."
      : configNotes(
          await forgetProjectConfig(project.cwd, { dryRun: true }),
          false,
        );
    return {
      success: true,
      message: `Would delete ${project.cwd} (${sessions(project.sessions)}).\n  ${path}${activeNote}\n${configNote}`,
      data: { ...data, deleted: false },
    };
  }

  if (active > 0 && !args.force) {
    return {
      success: false,
      message: `Refusing to delete ${project.cwd}: ${active} active session${active === 1 ? "" : "s"} run${active === 1 ? "s" : ""} there.\nClose ${active === 1 ? "it" : "them"} or pass --force.`,
    };
  }

  if (!args.yes) {
    return {
      success: false,
      message: `Refusing to delete ${project.cwd} (${sessions(project.sessions)}) without --yes.\nThis removes ${path} permanently and resets its trust config.\nRe-run with --yes to delete it.`,
    };
  }

  // Reset trust first: if the config cannot be updated, leave the project
  // intact rather than half-deleting it.
  let config: ForgetProjectResult | undefined;
  if (!args["keep-config"]) {
    try {
      config = await forgetProjectConfig(project.cwd);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Could not reset Claude Code trust config for ${project.cwd}: ${reason}.\nProject not deleted. Pass --keep-config to delete transcripts without touching trust.`,
      };
    }
  }

  await rm(path, { recursive: true, force: true });

  const notes = [
    config ? configNotes(config, active > 0) : "Kept Claude Code trust config (--keep-config).",
  ];
  return {
    success: true,
    message: `Deleted ${project.cwd} (${sessions(project.sessions)}).\n  ${path}\n${notes.join("\n")}`,
    data: {
      ...data,
      deleted: true,
      configPath: config?.configPath ?? null,
      trustReset: config?.removed ?? [],
      inheritedTrustCleared: config?.expiredAncestors ?? [],
    },
  };
}

export const projectDeleteCommand: CLICommand = {
  name: "project-delete",
  description:
    "Delete a project's transcripts and clear its Claude Code trust, including inherited trust",
  inputSchema: ProjectDeleteArgsSchema,
  positionalKeys: ["target"],
  execute: projectDelete,
  examples: [
    "use-code-cli project-delete use-stock --yes",
    "use-code-cli project-delete /w/use-stock --dry-run",
    "use-code-cli project-delete use-stock --yes --force",
    "use-code-cli project-delete use-stock --yes --keep-config",
  ],
};
