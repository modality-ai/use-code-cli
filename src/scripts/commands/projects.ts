import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { readProjects } from "../../lib/projects";
import { readSessions } from "../../lib/sessions";

const ProjectsArgsSchema = z.object({});

function formatTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("sv-SE").slice(0, 19);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

async function projects() {
  const [list, live] = await Promise.all([readProjects(), readSessions(false)]);

  // A project is "active" when a live session runs in its workspace.
  const activeByCwd = new Map<string, number>();
  for (const session of live) {
    activeByCwd.set(session.cwd, (activeByCwd.get(session.cwd) ?? 0) + 1);
  }

  const rows = list.map((p) => ({ ...p, active: activeByCwd.get(p.cwd) ?? 0 }));

  const message = rows.length
    ? rows
        .map(
          (p) =>
            `${p.cwd}  ${plural(p.sessions, "session")}  ${p.active} active  updated=${formatTime(p.updatedAt)}`,
        )
        .join("\n")
    : "No projects found in ~/.claude/projects.";

  return {
    success: true,
    message,
    data: rows.map((p) => ({
      dir: p.dir,
      cwd: p.cwd,
      sessions: p.sessions,
      active: p.active,
      updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
    })),
  };
}

export const projectsCommand: CLICommand = {
  name: "projects",
  aliases: ["project-list"],
  description: "List Claude Code projects with their session counts and last activity",
  inputSchema: ProjectsArgsSchema,
  positionalKeys: [],
  execute: projects,
  examples: ["use-code-cli projects", "use-code-cli projects --json"],
};
