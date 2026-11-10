import { fetchToolResult } from "../../../session/[name]/session-data";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "";
  const toolId = url.searchParams.get("toolId") || "";
  const result = await fetchToolResult(name, toolId);
  if (!result.success) {
    return Response.json(result, { status: result.error === "missing name or toolId" ? 400 : 404 });
  }
  return Response.json(result);
}