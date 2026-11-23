import React from "react";
import { aiTool } from "../../../../../scripts/index";
import type { ProjectConfigResult } from "../../../../../lib/web/react-data";
import ProjectConfig from "./ProjectConfig.client";

interface ProjectConfigPageProps {
  name?: string;
  data?: ProjectConfigResult;
}

export default function ProjectConfigPage(props: ProjectConfigPageProps) {
  const name = props?.name || "";
  const data = props?.data ?? null;
  const json = JSON.stringify({ name, data }).replace(/</g, "\\u003c");
  const payloadHtml = `window.__REACT_DATA__ = { projectConfig: ${json} };`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: payloadHtml }} />
      <ProjectConfig name={name} initial={{ name, data }} />
    </>
  );
}

export async function loadData(props?: { params?: Record<string, string>; name?: string }): Promise<ProjectConfigPageProps> {
  const name = props?.name || props?.params?.name || "";
  const result: ProjectConfigResult = await aiTool.execute({ command: "project", target: name });
  return { name, data: result };
}
