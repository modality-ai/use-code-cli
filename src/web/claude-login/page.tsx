import React from "react";
import ClaudeLoginApp from "./ClaudeLoginApp.client";

export interface ClaudeLoginPageProps {
  status?: Record<string, unknown> | null;
}

export default function ClaudeLoginPage(props: ClaudeLoginPageProps = {}) {
  return <ClaudeLoginApp status={props.status} />;
}

export async function loadData(): Promise<ClaudeLoginPageProps> {
  let status: Record<string, unknown> | null = null;
  try {
    const proc = Bun.spawn(["claude", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const parsed: unknown = JSON.parse(out.trim());
    status = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    status = null;
  }
  return { status };
}
