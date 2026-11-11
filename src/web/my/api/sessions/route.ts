import { fetchSessions } from "../../../../lib/live";

export async function GET(): Promise<Response> {
  const sessions = await fetchSessions();
  return Response.json({ success: true, data: sessions });
}
