"use client";

import React, { useState } from "react";
import "../../../lib/web/react-data";

export interface Project {
  dir?: string;
  cwd?: string;
  sessions?: number;
  active?: number;
  updatedAt?: string | null;
}

export interface ProjectsAppProps {
  initial?: Project[];
  fromScheduleAdd?: boolean;
}

const projectPath = (project: Project) => project.dir || project.cwd || "";

// Hydration data channel: page.tsx dehydrates the server-rendered projects into
// window.__REACT_DATA__ (see src/lib/web/react-data.ts). This component reads
// that global directly during hydration — no <script> tag is rendered here, so
// there is no hydration mismatch on the script's dangerouslySetInnerHTML.
export default function ProjectsApp({ initial, fromScheduleAdd: fromScheduleAddProp = false }: ProjectsAppProps) {
  const fromScheduleAdd =
    (typeof window !== "undefined" ? window.__REACT_DATA__?.projectsFromScheduleAdd : undefined) ?? fromScheduleAddProp;
  const projects: Project[] = (() => {
    const dehydrated = typeof window !== "undefined" ? window.__REACT_DATA__?.projects : undefined;
    if (Array.isArray(dehydrated)) return dehydrated;
    return Array.isArray(initial) ? initial : [];
  })();
  const [filter, setFilter] = useState("");

  const term = filter.trim().toLowerCase();
  const visible = term
    ? projects.filter((project) =>
        [project.dir ?? "", project.cwd ?? ""].some((value) => value.toLowerCase().includes(term)),
      )
    : projects;

  return (
    <div>
      <div className="mb-md flex flex-wrap items-center gap-2">
        <a href={fromScheduleAdd ? "/my/schedule" : "/"} className="text-xs text-accent-collaboration hover:underline">
          {fromScheduleAdd ? "← Back to schedule" : "Home"}
        </a>
        <span className="text-text-muted">/</span>
        <h1 className="text-2xl font-semibold font-display">
          {fromScheduleAdd ? "Choose a project for a new schedule item" : "Projects"}
        </h1>
      </div>

      {fromScheduleAdd && (
        <p className="mb-md text-sm text-text-muted">Pick a project, then add a schedule item for it.</p>
      )}

      {fromScheduleAdd && projects.length > 0 && (
        <div className="mb-md">
          <label htmlFor="project-filter" className="block text-[10px] font-medium uppercase leading-[14px] tracking-[0.16em] text-text-muted">
            Filter projects
          </label>
          <input
            id="project-filter"
            type="search"
            value={filter}
            onInput={(event) => setFilter(event.currentTarget.value)}
            placeholder="Filter by project path"
            className="mt-1 h-11 w-full rounded-[12px] border border-border bg-surface px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </div>
      )}

      {projects.length === 0 ? (
        <p className="text-text-muted">No projects found.</p>
      ) : visible.length === 0 ? (
        <p className="text-text-muted">No projects match “{filter}”.</p>
      ) : (
        visible.map((p, i) => {
          const path = projectPath(p);
          return (
            <div className="border border-border rounded-sm p-3 mb-sm bg-surface" key={path || i}>
              <a
                href={"/my/project/" + encodeURIComponent(path)}
                className="font-semibold text-accent-collaboration hover:underline"
              >
                {p.cwd || p.dir}
              </a>
              <div className="font-code text-sm text-text-muted">
                {(p.sessions ?? 0) + " session" + ((p.sessions ?? 0) === 1 ? "" : "s") +
                  " · " + (p.active ?? 0) + " active"}
              </div>
              {p.updatedAt && (
                <div className="text-text-muted text-xs">Updated {new Date(p.updatedAt).toLocaleString()}</div>
              )}
              {fromScheduleAdd && path && (
                <a
                  href={`/my/schedule/add?project=${encodeURIComponent(path)}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-collaboration hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  Add schedule item →
                </a>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
