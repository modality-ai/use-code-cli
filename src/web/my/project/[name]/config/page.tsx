import React from "react";

interface ProjectConfigPageProps {
  name?: string;
}

export default function ProjectConfigPage({ name }: ProjectConfigPageProps) {
  return (
    <div>
      <h1>{name ? `Project config: ${name}` : "Project config"}</h1>
    </div>
  );
}

export async function loadData(props?: { params?: Record<string, string>; name?: string }): Promise<ProjectConfigPageProps> {
  const name = props?.name || props?.params?.name || "";
  return { name };
}
