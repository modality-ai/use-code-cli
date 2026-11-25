"use client";

import React, { useCallback, useEffect, useState } from "react";
import ScheduleCreateForm from "../ScheduleCreateForm";
import { setScheduleNotice, writeLocalAdd, type ScheduleSaved } from "../schedule-model";

export interface ScheduleAddPageProps {
  date: string;
  project?: string;
  navigate?: (href: string) => void;
}

const PICKER_HREF = "/my/projects?from=schedule-add";

export default function ScheduleAddPage({ date: dateProp, project: projectProp, navigate }: ScheduleAddPageProps) {
  const dehydrated =
    typeof window !== "undefined" ? window.__REACT_DATA__?.scheduleAdd : undefined;
  const date = dehydrated?.date ?? dateProp ?? "";
  const project = dehydrated?.project ?? projectProp;
  const [error, setError] = useState<string | null>(null);
  const navigateTo = useCallback((href: string) => {
    if (navigate) navigate(href);
    else window.location.assign(href);
  }, [navigate]);

  useEffect(() => {
    if (!project) navigateTo(PICKER_HREF);
  }, [project, navigateTo]);

  const handleSave = (saved: ScheduleSaved) => {
    if (!writeLocalAdd(saved, date)) {
      setError("Could not save the schedule item. Check browser storage and try again.");
      return;
    }
    const message = `Added "${saved.title}" locally for ${saved.project}.`;
    setScheduleNotice(message);
    navigateTo("/my/schedule");
  };

  if (!project) {
    return (
      <main className="mx-auto w-full max-w-[440px] px-5 pt-5">
        <h1 className="text-2xl font-semibold font-display text-text-primary">Choose a project first</h1>
        <p className="mt-3 text-sm text-text-muted" role="status">
          Schedule items belong to a project. Redirecting to the picker…
        </p>
        <a
          href={PICKER_HREF}
          className="mt-4 inline-flex text-sm text-accent-collaboration hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Open the project picker
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pt-5">
      <a
        href={PICKER_HREF}
        className="inline-flex items-center gap-1 text-xs text-accent-collaboration hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        ← Choose another project
      </a>
      <h1 className="mt-2 text-2xl font-semibold font-display text-text-primary">Add schedule item</h1>
      <p className="mt-1 text-sm text-text-muted" data-testid="selected-project">Project: {project}</p>
      {error && (
        <p className="mt-3 rounded-[12px] border border-orange bg-orange/10 p-3 text-sm text-orange" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3">
        <ScheduleCreateForm date={date} project={project} onSave={handleSave} />
      </div>
    </main>
  );
}
