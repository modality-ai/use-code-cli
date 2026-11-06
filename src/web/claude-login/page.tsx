import React from "react";
import { CLAUDE_STATUS, LOGIN_MODE, LOGIN_BTN, STATUS_BTN, CODE_BOX, CODE_INPUT, SEND_CODE_BTN, LOGIN_OUTPUT } from "./dom-ids";

export interface ClaudeLoginPageProps {
  status: unknown;
}

export default function ClaudeLoginPage({ status }: ClaudeLoginPageProps) {
  const summary = status
    ? Object.keys(status as Record<string, unknown>)
        .map((k) => `${k}: ${JSON.stringify((status as Record<string, unknown>)[k])}`)
        .join("\n")
    : "Status unavailable";

  return (
    <div className="max-w-[720px] mx-auto my-6 p-4">
      <h1 className="text-2xl font-semibold font-display mb-md">Claude Code Login</h1>
      <p className="text-text-muted mb-md">
        Run the Claude Code CLI login flow on this server and write the resulting token back to Claude Code's config (~/.claude.json). Useful for remote servers where you can't run the CLI interactively.
      </p>

      <div className="border border-border rounded-sm p-3 mb-md bg-surface">
        <div className="font-semibold mb-xs">Current status</div>
        <pre id={CLAUDE_STATUS} className="font-code text-[13px] text-text-muted whitespace-pre-wrap">
          {summary}
        </pre>
      </div>

      <div className="border border-border rounded-sm p-3 mb-md bg-surface">
        <label className="block font-semibold mb-xs" htmlFor={LOGIN_MODE}>
          Account type
        </label>
        <select
          id={LOGIN_MODE}
          className="border border-border rounded-sm p-2 bg-surface text-text-primary w-full"
          defaultValue="claudeai"
        >
          <option value="claudeai">Claude subscription (default)</option>
          <option value="console">Anthropic Console (API usage billing)</option>
        </select>
        <div className="flex gap-2 mt-md">
          <button id={LOGIN_BTN} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold">
            Start login
          </button>
          <button id={STATUS_BTN} className="px-3 py-2 rounded-sm border border-border">
            Refresh status
          </button>
        </div>
      </div>

      <div id={CODE_BOX} className="flex gap-2 mt-md" style={{ display: "none" }}>
        <input
          id={CODE_INPUT}
          className="flex-1 border border-border rounded-sm p-2 bg-surface text-text-primary font-code text-[13px]"
          placeholder="Paste the code from the browser here"
        />
        <button id={SEND_CODE_BTN} className="px-3 py-2 rounded-sm bg-accent-collaboration text-white font-semibold">
          Send code
        </button>
      </div>
      <div className="border border-border rounded-sm p-3 bg-surface mt-md">
        <div className="font-semibold mb-xs">Output</div>
        <pre id={LOGIN_OUTPUT} className="font-code text-[12px] whitespace-pre-wrap max-h-[400px] overflow-auto text-text-muted">
        </pre>
      </div>
    </div>
  );
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
