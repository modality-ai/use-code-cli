import React from "react";
import ProjectExec from "./ProjectExec.client";

export interface ProjectExecPageProps {
  name?: string;
}

export default function ProjectExecPage(props: ProjectExecPageProps) {
  const name = props?.name || "";
  const json = JSON.stringify({ name }).replace(/</g, "\\u003c");
  const payloadHtml = `window.__REACT_DATA__ = { projectExec: ${json} };`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: payloadHtml }} />
      <ProjectExec name={name} />
    </>
  );
}

export async function loadData(props?: { params?: Record<string, string>; name?: string }): Promise<ProjectExecPageProps> {
  const name = props?.name || props?.params?.name || "";
  return { name };
}
