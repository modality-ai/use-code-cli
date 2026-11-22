import React from "react";
import { fetchSchedule, type ScheduleData } from "../../../lib/schedule";
import ScheduleApp from "./ScheduleApp.client";

export interface SchedulePageProps {
  schedule: ScheduleData;
}

export default function SchedulePage({ schedule }: SchedulePageProps) {
  const json = JSON.stringify(schedule).replace(/</g, "\\u003c");
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.__REACT_DATA__ = { schedule: ${json} };` }} />
      <ScheduleApp initial={schedule} />
    </>
  );
}

export async function loadData(): Promise<SchedulePageProps> {
  return { schedule: await fetchSchedule() };
}
