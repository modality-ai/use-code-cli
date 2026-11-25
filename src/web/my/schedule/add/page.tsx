import React from "react";
import { todayKey } from "../../../../lib/schedule-date";
import ScheduleAddPage from "./ScheduleAddPage.client";

export interface ScheduleAddRouteProps {
  date: string;
  project?: string;
}

export default function ScheduleAddRoute({ date, project }: ScheduleAddRouteProps) {
  const json = JSON.stringify({ date, project }).replace(/</g, "\\u003c");
  const payloadHtml = `window.__REACT_DATA__ = { scheduleAdd: ${json} };`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: payloadHtml }} />
      <ScheduleAddPage date={date} project={project} />
    </>
  );
}

export async function loadData(props?: { request?: Request }): Promise<ScheduleAddRouteProps> {
  const url = props?.request ? new URL(props.request.url) : undefined;
  const project = url?.searchParams.get("project") || undefined;
  return { date: todayKey(), project };
}
