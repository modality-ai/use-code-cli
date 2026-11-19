import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { rm, stat } from "node:fs/promises";
import {
  describeProjects,
  findProject,
  readProjects,
  type ProjectInfo,
} from "./projects";
import {
  encodeProjectDir,
  matchesSessionFilter,
  NAMES_FILE,
  PROJECTS_DIR,
  readSessionNames,
  readSessions,
  transcriptPath,
  type SessionInfo,
} from "./sessions";

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

export async function autoclean(args: {
  keep: string;
  project?: string;
  "dry-run"?: boolean;
  yes?: boolean;
}): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  const keep = Number(args.keep);
  if (!Number.isFinite(keep) || keep < 1) {
    return {
      success: false,
      message: "keep must be a positive integer >= 1, e.g. --keep 50",
    };
  }

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

  const withActivity = await Promise.all(
    inactive.map(async (s) => ({ s, activity: await activityOf(s) })),
  );
  withActivity.sort((a, b) => b.activity - a.activity);
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

  const dryRun = !!args["dry-run"];
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
        continue;
      }
    }
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
        const { prettyJsonFile } = await import("./output/json");
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

