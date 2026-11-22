import { fetchSchedule } from "../../../../lib/schedule";

export async function GET(): Promise<Response> {
  try {
    const data = await fetchSchedule();
    return Response.json({ success: true, data });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
