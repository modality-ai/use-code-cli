import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { rm, stat } from "node:fs/promises";
import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { plural } from "../../lib/output/format";
import {
  describeProjects,
  findProject,
  readProjects,
  type ProjectInfo,
} from "../../lib/projects";
import {
  encodeProjectDir,
  matchesSessionFilter,
  NAMES_FILE,
  PROJECTS_DIR,
  readSessionNames,
  readSessions,
  transcriptPath,
  type SessionInfo,
} from "../../lib/sessions";

const AutocleanArgsSchema = z.object({
  keep: z
    .string()
    .optional()
    .default("50")
    .refine(
      (v) => /^\d+$/.test(v) && Number(v) >= 1,
      "keep must be a positive integer >= 1, e.g. --keep 50",
    )
    .describe("Number of most-recent sessions to keep (default 50)"),
  project: z
    .string()
    .optional()
    .describe("Project workspace path, directory name, or unique path suffix (default: current working directory)"),
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
});

type AutocleanArgs = z.infer<typeof AutocleanArgsSchema>;

function label(s: SessionInfo): string {
  return s.name ?? s.sessionId;
}

async function activityOf(s: SessionInfo): Promise<number> {
  const path = await transcriptPath(s);
  if (path) {
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      // Fall through to the session's last activity timestamp.
    }
  }
  return s.updatedAt ?? 0;
}

async function autoclean(args: AutocleanArgs) {
  const keep = Number(args.keep);

  const projects = await readProjects();
  const target = (args.project ?? process.cwd()).replace(/\/+$/, "");
  const matches = findProject(projects, target);

  if (matches.length > 1) {
    return {
      success: false,
      message: `"${target}" is ambiguous; use a full path:\n${describeProjects(matches)}`,
    };
  }

  let project: ProjectInfo | undefined = matches[0];
  if (!project) {
    const candidate = resolve(target);
    if (existsSync(candidate)) {
      try {
        if ((await stat(candidate)).isDirectory()) {
          project = {
            dir: encodeProjectDir(candidate),
            cwd: candidate,
            sessions: 0,
            updatedAt: 0,
          };
        }
      } catch {
        // Fall through to the not-found branch below.
      }
    }
    if (!project) {
      return {
        success: false,
        message: `No project matches "${target}".\nRun \`use-code-cli projects\` to see the available projects.`,
      };
    }
  }

  const projectDir = join(PROJECTS_DIR, encodeProjectDir(project.cwd));

  const all = await readSessions(true);
  const candidates = all.filter((s) =>
    matchesSessionFilter(s, { filterProject: project!.cwd }),
  );

  const active = candidates.filter((s) => s.online);
  const inactive = candidates.filter((s) => !s.online);

  // Never delete active sessions; if they already fill `keep`, there is nothing
  // to clean.
  if (active.length >= keep) {
    const lines = [
      `Project: ${project.cwd}`,
      `Active sessions (${active.length}) already reach the keep limit (${keep}); nothing to clean.`,
    ];
    if (active.length > 0) {
      lines.push("Skipped (active):");
      for (const s of active) lines.push(`  - ${label(s)}  (${s.sessionId})`);
    }
    return {
      success: true,
      message: lines.join("\n"),
      data: { project: project.cwd, keep, deleted: [], skipped: active.map((s) => s.sessionId), kept: active.length },
    };
  }

  const slotsForInactive = keep - active.length;

  // Sort inactive candidates by transcript activity (newest first); keep the top
  // `slotsForInactive`, delete the rest.
  const withActivity = await Promise.all(
    inactive.map(async (s) => ({ s, activity: await activityOf(s) })),
  );
  withActivity.sort((a, b) => b.activity - a.activity);
  const keptInactive = withActivity.slice(0, slotsForInactive).map((x) => x.s);
  const toDelete = withActivity.slice(slotsForInactive).map((x) => x.s);

  if (toDelete.length === 0) {
    const lines = [
      `Project: ${project.cwd}`,
      `Nothing to clean: ${candidates.length} session(s) fit within keep=${keep}.`,
    ];
    return {
      success: true,
      message: lines.join("\n"),
      data: { project: project.cwd, keep, deleted: [], skipped: active.map((s) => s.sessionId), kept: candidates.length },
    };
  }

  // Safety: only transcripts physically inside the project's encoded directory.
  const deletable: SessionInfo[] = [];
  const skippedPath: SessionInfo[] = [];
  for (const s of toDelete) {
    const path = await transcriptPath(s);
    if (path && dirname(path) === projectDir) {
      deletable.push(s);
    } else {
      skippedPath.push(s);
    }
  }

  const dryRun = args["dry-run"];
  const verb = dryRun ? "Would delete" : "Deleted";

  if (!dryRun && !args.yes) {
    const lines = [
      `Refusing to clean ${project.cwd}: ${deletable.length} session(s) would be removed.`,
      `Re-run with --yes (or --dry-run to preview) to proceed.`,
      `Would delete (preview):`,
    ];
    for (const s of deletable) {
      const path = await transcriptPath(s);
      lines.push(`  - ${label(s)}  (${s.sessionId})  ${path ?? ""}`);
    }
    return {
      success: false,
      message: lines.join("\n"),
      data: { project: project.cwd, keep, deleted: [], wouldDelete: deletable.map((s) => s.sessionId) },
    };
  }

  const deleted: string[] = [];
  const pathById = new Map<string, string>();
  for (const s of deletable) {
    const pth = await transcriptPath(s);
    if (pth) pathById.set(s.sessionId, pth);
  }
  if (!dryRun) {
    for (const s of deletable) {
      const path = pathById.get(s.sessionId);
      if (!path) continue;
      try {
        await rm(path);
        deleted.push(s.sessionId);
      } catch {
        // Leave the registry entry if the file could not be removed.
        continue;
      }
    }
    // Clean up name registry entries for the removed sessions.
    try {
      const names = await readSessionNames();
      let changed = false;
      for (const id of deleted) {
        if (Object.prototype.hasOwnProperty.call(names, id)) {
          delete names[id];
          changed = true;
        }
      }
      if (changed) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(dirname(NAMES_FILE), { recursive: true });
        const { prettyJsonFile } = await import("../../lib/output/json");
        await writeFile(NAMES_FILE, prettyJsonFile(names), "utf8");
      }
    } catch {
      // Best-effort registry cleanup.
    }
  }

  const keptCount = candidates.length - (dryRun ? deletable.length : deleted.length);

  const lines: string[] = [];
  lines.push(`Project: ${project.cwd}`);
  lines.push(`keep=${keep}, candidates=${candidates.length}, active=${active.length}`);
  lines.push("");
  lines.push(`${verb} ${dryRun ? deletable.length : deleted.length} session(s):`);
  const list = dryRun ? deletable : deletable.filter((s) => deleted.includes(s.sessionId));
  for (const s of list) {
    const path = pathById.get(s.sessionId) ?? (await transcriptPath(s));
    lines.push(`  - ${label(s)}  (${s.sessionId})  ${path ?? ""}`);
  }
  if (skippedPath.length > 0) {
    lines.push("");
    lines.push("Skipped (outside project dir):");
    for (const s of skippedPath) lines.push(`  - ${label(s)}  (${s.sessionId})`);
  }
  lines.push("");
  lines.push(`Kept ${keptCount} session(s).`);
  if (active.length > 0) {
    lines.push("");
    lines.push("Skipped (active):");
    for (const s of active) lines.push(`  - ${label(s)}  (${s.sessionId})`);
  }
  if (dryRun) {
    lines.push("");
    lines.push("Dry run: no files were deleted. Re-run with --yes to delete.");
  }

  return {
    success: true,
    message: lines.join("\n"),
    data: {
      project: project.cwd,
      keep,
      deleted: dryRun ? [] : deleted,
      wouldDelete: dryRun ? deletable.map((s) => s.sessionId) : [],
      skipped: active.map((s) => s.sessionId),
      kept: keptCount,
    },
  };
}

export const autocleanCommand: CLICommand = {
  name: "autoclean",
  description:
    "Clean old sessions of a project, keeping only the most recent N (default 50). Never deletes active sessions.",
  inputSchema: AutocleanArgsSchema,
  positionalKeys: ["keep"],
  execute: autoclean,
  examples: [
    "use-code-cli autoclean",
    "use-code-cli autoclean 30",
    "use-code-cli autoclean --project /w/use-stock --dry-run",
    "use-code-cli autoclean 20 --yes",
  ],
};