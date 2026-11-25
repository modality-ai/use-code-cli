import React from "react";
import { aiTool } from "../../../scripts/index";
import ProjectsApp from "./ProjectsApp.client";
import type { Project } from "./ProjectsApp.client";

export interface ProjectsPageProps {
  projects?: Project[];
  fromScheduleAdd?: boolean;
}

export default function ProjectsPage(props: ProjectsPageProps) {
  const projects = Array.isArray(props?.projects) ? props.projects : [];
  const json = JSON.stringify(projects).replace(/</g, "\\u003c");
  const payloadHtml = `window.__REACT_DATA__ = { projects: ${json}, projectsFromScheduleAdd: ${props.fromScheduleAdd === true} };`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: payloadHtml }} />
      <ProjectsApp initial={projects} fromScheduleAdd={props.fromScheduleAdd} />
    </>
  );
}

export async function loadData(props?: { params?: Record<string, string>; request?: Request }): Promise<ProjectsPageProps> {
  const result = (await aiTool.execute({ command: "projects" })) as { success?: boolean; data?: unknown[] };
  const projects = Array.isArray(result?.data) ? (result.data as Project[]) : [];
  const url = props?.request ? new URL(props.request.url) : undefined;
  const fromScheduleAdd = url?.searchParams.get("from") === "schedule-add";
  return { projects, fromScheduleAdd };
}
