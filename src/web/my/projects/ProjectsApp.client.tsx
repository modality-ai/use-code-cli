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

// Hydration data channel: page.tsx dehydrates the server-rendered projects into
// window.__REACT_DATA__ (see src/lib/web/react-data.ts). This component reads
// that global directly during hydration — no <script> tag is rendered here, so
// there is no hydration mismatch on the script's dangerouslySetInnerHTML.
export default function ProjectsApp({ initial }: { initial?: Project[] }) {
  const [projects, setProjects] = useState<Project[]>(() => {
    const dehydrated = typeof window !== "undefined" ? window.__REACT_DATA__?.projects : undefined;
    if (Array.isArray(dehydrated)) return dehydrated;
    return Array.isArray(initial) ? initial : [];
  });

  const rows = Array.isArray(projects) ? projects : [];
  if (rows.length === 0) return <p className="text-text-muted">No projects found.</p>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-md">
        <a href="/" className="text-xs text-accent-collaboration hover:underline">Home</a>
        <span className="text-text-muted">/</span>
        <h1 className="text-2xl font-semibold font-display">Projects</h1>
      </div>
      {rows.map((p, i) => (
        <div className="border border-border rounded-sm p-3 mb-sm bg-surface" key={i}>
          <a
            href={"/my/project/" + encodeURIComponent(p.dir || p.cwd || "")}
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
        </div>
      ))}
    </div>
  );
}
