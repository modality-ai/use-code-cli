import React from "react";
import { aiTool } from "../../../scripts/index";
import ProjectsApp from "./ProjectsApp.client";
import type { Project } from "./ProjectsApp.client";

export interface ProjectsPageProps {
  projects?: Project[];
}

export default function ProjectsPage(props: ProjectsPageProps) {
  const projects = Array.isArray(props?.projects) ? props.projects : [];
  const json = JSON.stringify(projects).replace(/</g, "\\u003c");
  const payloadHtml = `window.__REACT_DATA__ = { projects: ${json} };`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: payloadHtml }} />
      <ProjectsApp initial={projects} />
    </>
  );
}

export async function loadData(props?: { params?: Record<string, string> }): Promise<ProjectsPageProps> {
  const result = (await aiTool.execute({ command: "projects" })) as { success?: boolean; data?: unknown[] };
  const projects = Array.isArray(result?.data) ? (result.data as Project[]) : [];
  return { projects };
}
