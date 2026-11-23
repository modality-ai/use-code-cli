"use client";

import { useState } from "react";
import type { ProjectConfigResult } from "../../../../../lib/web/react-data";

function formatUpdated(value: ProjectConfigResult["updatedAt"]): string {
  if (value === null || value === undefined || value === "" || value === 0) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

interface ProjectConfigInitial extends ProjectConfigResult {
  name?: string;
}

interface ProjectConfigProps {
  name?: string;
  initial?: ProjectConfigInitial | null;
}

export default function ProjectConfig({ name: initialName, initial }: ProjectConfigProps) {
  const dehydrated = typeof window !== "undefined" ? window.__REACT_DATA__?.projectConfig : undefined;
  const name = typeof dehydrated?.name === "string" ? dehydrated.name : (initialName ?? "");

  const result = dehydrated?.data ?? initial?.data ?? initial ?? null;
  const detail = result?.data ?? (result && !result.success ? null : result);
  const ok = Boolean(detail);

  const baseConfig = (detail && typeof detail === "object") ? detail : {};

  const startPo = typeof baseConfig?.po === "string" ? baseConfig.po : "";
  const startAgentBin = typeof baseConfig?.agentBin === "string" ? baseConfig.agentBin : "";

  const [value, setValue] = useState(startPo);
  const [saved, setSaved] = useState(startPo);
  const [agentBinValue, setAgentBinValue] = useState(startAgentBin);
  const [savedAgentBin, setSavedAgentBin] = useState(startAgentBin);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changed = value !== saved || agentBinValue !== savedAgentBin;

  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const payload = { po: value, agentBin: agentBinValue };
      const r = await fetch("/my/api/project/" + encodeURIComponent(name || "") + "/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) {
        setError(d?.error || "failed to save");
        return;
      }
      const nextPo = (typeof d?.data?.po === "string" ? d.data.po : (typeof d?.po === "string" ? d.po : value));
      const nextAgentBin = (typeof d?.data?.agentBin === "string" ? d.data.agentBin : (typeof d?.agentBin === "string" ? d.agentBin : agentBinValue));
      setSaved(nextPo);
      setValue(nextPo);
      setSavedAgentBin(nextAgentBin);
      setAgentBinValue(nextAgentBin);
      setStatus("Saved");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!ok) {
    return (
      <div className="max-w-4xl mx-auto my-6 p-4">
        <h1 className="text-xl font-semibold mb-4">{name ? `Project config: ${name}` : "Project config"}</h1>
        <div className="bg-surface border border-border rounded-xl p-6">
          <p className="text-text-primary mb-4">{result?.message || "Project not found."}</p>
          <a href={name ? `/my/project/${encodeURIComponent(name)}` : "/my/projects"} className="text-accent underline">← Back to select project</a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto my-6 p-4">
      <h1 className="text-xl font-semibold mb-4">{name ? `Project config: ${name}` : "Project config"}</h1>
      <div className="bg-surface border border-border rounded-xl p-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="font-medium">cwd</dt>
          <dd>{detail?.cwd ?? "—"}</dd>
          <dt className="font-medium">dirName</dt>
          <dd>{detail?.dir ?? "—"}</dd>
          <dt className="font-medium">sessions</dt>
          <dd>{detail?.sessions ?? 0} sessions ({detail?.active ?? 0} active)</dd>
          <dt className="font-medium">active</dt>
          <dd>{detail?.active ?? 0}</dd>
          <dt className="font-medium">updated</dt>
          <dd>{formatUpdated(detail?.updatedAt)}</dd>
          <dt className="font-medium">path</dt>
          <dd>{detail?.path ?? "—"}</dd>
        </dl>
        <div className="mt-4">
          <label htmlFor="project-po" className="block font-medium mb-1">Project PO</label>
          <div className="flex gap-2 items-center">
            <input
              id="project-po"
              aria-label="Project PO"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="border border-border rounded px-2 py-1 bg-surface text-text-primary"
            />
          </div>
          {status && <p className="text-text-muted text-sm mt-1">{status}</p>}
          {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        </div>
        <div className="mt-4">
          <label htmlFor="agent-bin" className="block font-medium mb-1">Agent bin (binary)</label>
          <input
            id="agent-bin"
            aria-label="Agent bin (binary)"
            value={agentBinValue}
            onChange={(e) => setAgentBinValue(e.target.value)}
            className="border border-border rounded px-2 py-1 bg-surface text-text-primary w-full"
          />
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={save}
            disabled={saving || !changed}
            className="px-3 py-1 rounded bg-accent text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="mt-4">
          <a href={name ? `/my/project/${encodeURIComponent(name)}` : "/my/projects"} className="text-accent underline">← Back to select project</a>
        </div>
      </div>
    </div>
  );
}
