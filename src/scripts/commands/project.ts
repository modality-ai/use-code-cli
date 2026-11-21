import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { formatTime, plural } from "../../lib/output/format";
import { findProject, readProjects, type ProjectInfo } from "../../lib/projects";
import { getProjectPo, setProjectPoAsync } from "../../lib/project-po";
import { encodeProjectDir, PROJECTS_DIR, readSessions } from "../../lib/sessions";
import { autoclean } from "../../lib/autoclean";

const ProjectArgsSchema = z.object({
  target: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Project workspace path, directory name, or unique path suffix; defaults to the current working directory",
    ),
  autoclean: z
    .boolean()
    .optional()
    .default(false)
    .describe("Clean old sessions of the project, keeping only the most recent N (default 50)"),
  keep: z
    .string()
    .optional()
    .default("50")
    .refine(
      (v) => /^\d+$/.test(v) && Number(v) >= 1,
      "keep must be a positive integer >= 1, e.g. --keep 50",
    )
    .describe("Number of most-recent sessions to keep (default 50)"),
  "dry-run": z
    .boolean()
    .optional()
    .default(false)
    .describe("Report what would be deleted, without deleting it"),
  yes: z
    .boolean()
    .optional()
    .default(false)
    .describe("Delete without stopping at the confirmation gate"),
  po: z
    .string()
    .min(1)
    .optional()
    .describe("Set a custom PO session name for this project (stored in ~/.use-code-cli/projects.json)"),
  project: z
    .string()
    .optional()
    .describe("Project workspace path, directory name, or unique path suffix (default: current working directory)"),
});

type ProjectArgs = z.infer<typeof ProjectArgsSchema>;

function row(label: string, value: string | undefined): string {
  return `  ${label.padEnd(11)} ${value && value.trim() !== "" ? value : "—"}`;
}

async function project(args: ProjectArgs) {
  if (args.autoclean) {
    let keep = args.keep;
    let target = args.project ?? args.target;
    if (target && /^\d+$/.test(target) && keep === "50" && !args.project) {
      keep = target;
      target = undefined;
    }
    return autoclean({
      keep,
      project: target,
      "dry-run": args["dry-run"],
      yes: args.yes,
    });
  }

  const projects = await readProjects();
  const target = (args.target ?? process.cwd()).replace(/\/+$/, "");
  const matches = findProject(projects, target);

  if (matches.length > 1) {
    return {
      success: false,
      message: `"${args.target ?? target}" is ambiguous; use a full path:\n${matches
        .map((p) => `  ${p.cwd}  (${p.sessions} session${p.sessions === 1 ? "" : "s"})`)
        .join("\n")}`,
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
        success: false,
        message: `No project matches "${args.target ?? target}".\nRun \`use-code-cli projects\` to see the available projects.`,
      };
    }
  }

  if (args.po) {
    await setProjectPoAsync(proj.dir, args.po);
    return {
      success: true,
      message: `po set to "${args.po}" for ${proj.cwd}`,
      data: { dir: proj.dir, cwd: proj.cwd, po: args.po },
    };
  }

  const path = join(PROJECTS_DIR, proj.dir);
  const live = await readSessions(false);
  const active = live.filter((s) => s.cwd === proj!.cwd).length;

  const lines = [
    proj.cwd,
    row("dirName", proj.dir),
    row("sessions", `${plural(proj.sessions, "session")} (${active} active)`),
    row("active", String(active)),
    row("updated", proj.updatedAt ? formatTime(proj.updatedAt) : undefined),
    row("po", getProjectPo(proj.dir, proj.cwd)),
    row("path", path),
  ];

  return {
    success: true,
    message: lines.join("\n"),
    data: {
      dir: proj.dir,
      cwd: proj.cwd,
      sessions: proj.sessions,
      active,
      updatedAt: proj.updatedAt ? new Date(proj.updatedAt).toISOString() : null,
      path,
      po: getProjectPo(proj.dir, proj.cwd),
    },
  };
}

export const projectCommand: CLICommand = {
  name: "project",
  aliases: ["project-detail", "project-info"],
  description: "Show one project's workspace, session counts, and transcript location",
  inputSchema: ProjectArgsSchema,
  positionalKeys: ["target"],
  execute: project,
  examples: [
    "use-code-cli project use-stock",
    "use-code-cli project /w/use-stock",
    "use-code-cli project use-stock --json",
  ],
};
