import React from "react";
import ClaudeLoginApp from "./ClaudeLoginApp.client";

export interface ClaudeLoginPageProps {
  status?: unknown;
}

export default function ClaudeLoginPage(props: ClaudeLoginPageProps = {}) {
  return <ClaudeLoginApp status={props.status} />;
}

export async function loadData(): Promise<ClaudeLoginPageProps> {
  let status: unknown = null;
  try {
    const proc = Bun.spawn(["claude", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    status = JSON.parse(out.trim());
  } catch {
    status = null;
  }
  return { status };
}
