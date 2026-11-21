import { fetchThinking } from "../../../session/[name]/session-data";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "";
  const indexParam = url.searchParams.get("index");
  const entryIndex = indexParam === null ? NaN : Number(indexParam);
  const result = await fetchThinking(name, entryIndex);
  if (!result.success) {
    const status =
      result.error === "missing name or index" ? 400 :
      result.error === "cannot read transcript" ? 500 : 404;
    return Response.json(result, { status });
  }
  return Response.json(result);
}
