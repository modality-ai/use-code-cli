import { basename, join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { PROJECTS_DIR, readTranscriptCwd } from "./sessions";

/** One project directory under ~/.claude/projects. */
export interface ProjectInfo {
  /** Encoded directory name Claude Code uses for the workspace. */
  dir: string;
  /** Workspace path recorded by the transcripts, or the directory name when unknown. */
  cwd: string;
  /** Number of session transcripts in the project. */
  sessions: number;
  /** Newest transcript's mtime, in milliseconds since the epoch. */
  updatedAt: number;
}

/** Every project holding at least one transcript, newest activity first. */
export async function readProjects(): Promise<ProjectInfo[]> {
  let dirs: string[];
  try {
    dirs = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }

  const projects: ProjectInfo[] = [];
  for (const dir of dirs) {
    const path = join(PROJECTS_DIR, dir);
    let files: string[];
    try {
      files = (await readdir(path)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (files.length === 0) continue;

    // The newest transcript names the workspace; it is the one most likely to
    // still exist after a rename, so prefer it over the encoded directory name.
    let updatedAt = 0;
    let newest: string | undefined;
    for (const file of files) {
      try {
        const st = await stat(join(path, file));
        if (st.mtimeMs > updatedAt) {
          updatedAt = st.mtimeMs;
          newest = join(path, file);
        }
      } catch {
        // Skip an unreadable transcript; the readable ones still count.
      }
    }

    const cwd = (newest ? await readTranscriptCwd(newest) : undefined) ?? dir;
    projects.push({ dir, cwd, sessions: files.length, updatedAt });
  }

  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Exact path / dir / basename wins; otherwise a unique workspace-path suffix. */
export function findProject(projects: ProjectInfo[], target: string): ProjectInfo[] {
  const exact = projects.filter(
    (p) => p.cwd === target || p.dir === target || basename(p.cwd) === target,
  );
  if (exact.length > 0) return exact;
  return projects.filter((p) => p.cwd.endsWith(`/${target}`));
}

/** Candidate projects rendered for an "ambiguous target" error. */
export function describeProjects(projects: ProjectInfo[]): string {
  return projects
    .map(
      (p) =>
        `  ${p.cwd}  (${p.sessions} session${p.sessions === 1 ? "" : "s"})`,
    )
    .join("\n");
}
