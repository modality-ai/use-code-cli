"use client";

import { useState } from "react";
import { stripAnsi } from "modality-cli-kit/strip-ansi";
import "../../../../lib/web/react-data";

export interface ProjectExecProps {
  name?: string;
}

export default function ProjectExec({ name: initialName }: ProjectExecProps) {
  // Read from window during render (not in initializer) to ensure hydration match
  const dehydrated = typeof window !== "undefined" ? window.__REACT_DATA__?.projectExec?.name : undefined;
  const name = typeof dehydrated === "string" ? dehydrated : (initialName ?? "");

  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cwd, setCwd] = useState<string | null>(null);
  const [inBackground, setInBackground] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stdin, setStdin] = useState("");

  const sendToPty = async (data: string) => {
    if (!jobId) return;
    try {
      const r = await fetch("/my/api/pty/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, data }),
      });
      if (!r.ok) setError("failed to send input (" + r.status + ")");
    } catch (e) {
      setError(String(e));
    }
  };

  const run = async () => {
    if (!command.trim() || running) return;
    setRunning(true);
    setError(null);
    setOutput("");
    setJobId(null);
    try {
      const r = await fetch("/my/api/project/" + encodeURIComponent(name || "") + "/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, command, background: inBackground }),
      });
      const cwdHeader = r.headers.get("X-Cwd");
      if (cwdHeader) setCwd(decodeURIComponent(cwdHeader));
      const headerJobId = r.headers.get("X-Job-Id");
      if (headerJobId) setJobId(headerJobId);
      const contentType = r.headers.get("Content-Type") || "";
      if (inBackground && contentType.includes("application/json")) {
        const d = await r.json();
        if (d?.success) {
          if (d?.jobId) setJobId(d.jobId);
          setOutput(`Started in background\nPID: ${d?.pid}\nLog: ${d?.log}\n jobId: ${d?.jobId}`);
        } else {
          setError(d?.error || "failed to start background process");
        }
        return;
      }
      if (!r.ok) {
        // API errors (404 project not found, 400 missing fields) arrive as
        // JSON, not a terminal stream — surface them as errors, not output.
        try {
          const d = await r.json();
          setError(d?.error || "request failed: " + r.status);
        } catch {
          setError("request failed: " + r.status);
        }
        setRunning(false);
        return;
      }
      const reader = r.body?.getReader();
      if (!reader) {
        setError("no response body");
        setRunning(false);
        return;
      }
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setOutput(accumulated);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="mb-md grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-3">
        <a href="/my/projects" className="order-1 shrink-0 whitespace-nowrap text-xs text-accent-collaboration hover:underline">← Back to projects</a>
        <h1
          className="order-3 col-span-2 min-w-0 truncate text-2xl font-semibold font-display sm:order-2 sm:col-span-1 sm:flex-1"
          title={`Project: ${name}`}
        >
          Project: {name}
        </h1>
        <div className="order-2 flex shrink-0 items-center gap-2 sm:order-3 sm:ml-auto">
          <a
            href={`/my/project/${encodeURIComponent(name)}/config`}
            title="Project config"
            aria-label="Project config"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-transparent text-text-muted transition-colors duration-150 hover:border-border hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </a>
          <a
            href={`/my/schedule/add?project=${encodeURIComponent(name)}`}
            title="Add schedule item"
            aria-label="Add schedule item"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-transparent text-text-muted transition-colors duration-150 hover:border-border hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
              <path d="M16 2v4" />
              <path d="M8 2v4" />
              <path d="M3 10h18" />
              <path d="M19 16v6" />
              <path d="M16 19h6" />
            </svg>
          </a>
        </div>
      </div>
      <div className="mb-sm">
        <input
          id="bash-command"
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="Enter bash command..."
          className="w-full px-3 py-2 rounded-sm border border-border bg-surface text-text-primary font-code"
        />
      </div>
      <div className="flex items-center gap-3 mb-md">
        <button
          id="bash-run"
          onClick={run}
          disabled={running || !command.trim()}
          className="px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
        >
          {running ? "Running..." : "Run"}
        </button>
        <label className="flex items-center gap-1 text-sm text-text-muted cursor-pointer">
          <input
            id="bash-background"
            type="checkbox"
            checked={inBackground}
            onChange={(e) => setInBackground(e.target.checked)}
          />
          Run in background
        </label>
      </div>
      {cwd && <div className="text-xs text-text-muted mb-sm font-code">cwd: {cwd}</div>}
      {jobId && (
        <div className="flex items-center gap-2 mb-sm">
          <input
            id="pty-input"
            type="text"
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && stdin) {
                sendToPty(stdin + "\n");
                setStdin("");
              }
            }}
            placeholder="Send keystrokes to the running process..."
            className="flex-1 px-3 py-2 rounded-sm border border-border bg-surface text-text-primary font-code"
          />
          <button
            id="pty-send"
            onClick={() => { if (stdin) { sendToPty(stdin + "\n"); setStdin(""); } }}
            className="px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
          >
            Send
          </button>
          <button
            id="pty-intr"
            onClick={() => sendToPty("\u0003")}
            title="Send Ctrl-C"
            className="px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
          >
            Ctrl-C
          </button>
        </div>
      )}
      {error && <div className="text-red-500 text-sm mb-sm">{error}</div>}
      {output !== null && (
        <pre className="border border-border rounded-sm p-3 bg-surface font-code text-sm overflow-auto max-h-96 whitespace-pre-wrap">
          {stripAnsi(output)}
        </pre>
      )}
    </div>
  );
}
