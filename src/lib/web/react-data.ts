import type { Session } from "../../web/my/sessions/SessionsApp.client";
import type { SessionData } from "../../web/my/session/[name]/session-data";
import type { Project } from "../../web/my/projects/ProjectsApp.client";
import type { ProjectPoEntry } from "../project-store";
import type { ScheduleData } from "../schedule";

/** Project detail payload, either the config itself or an aiTool result envelope. */
export interface ProjectConfigResult extends ProjectPoEntry {
  success?: boolean;
  message?: string;
  data?: ProjectConfigResult | null;
}

/**
 * Single data channel for hydrated routes: page.tsx dehydrates its slice into
 * `window.__REACT_DATA__`; 'use client' components read it for hydration.
 * One namespace and per-route slices replace per-route `window.__X__` globals.
 */
export interface ReactDataEnvelope {
  sessions?: Session[];
  sessionView?: {
    name: string;
    initial: SessionData | null;
  };
  projects?: Project[];
  projectsFromScheduleAdd?: boolean;
  projectExec?: {
    name: string;
  };
  projectConfig?: {
    name: string;
    data?: ProjectConfigResult;
  };
  passkey?: {
    hasCredentials: boolean;
  };
  schedule?: ScheduleData;
  scheduleAdd?: {
    date: string;
    project?: string;
  };
}

declare global {
  interface Window {
    __REACT_DATA__?: ReactDataEnvelope;
  }
}
