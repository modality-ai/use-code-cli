import { fetchSessionData } from "../../session/[name]/session-data";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "";
  const statusOnly = url.searchParams.get("statusOnly") === "1";

  const result = await fetchSessionData(name, { includeEntries: !statusOnly });
  if (!result.success) {
    return Response.json(result, { status: result.error === "missing name" ? 400 : result.error === "cannot read transcript" ? 500 : 404 });
  }
  return Response.json(result);
}
