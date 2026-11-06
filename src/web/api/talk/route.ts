import { aiTool } from "../../../scripts/index";

export async function POST(request: Request): Promise<Response> {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const name = String(body?.name || "").trim();
  const message = String(body?.message || "").trim();
  if (!name || !message) {
    return Response.json({ success: false, error: "missing name or message" }, { status: 400 });
  }
  try {
    const result = await aiTool.execute({ command: "talk", target: name, message, "one-way": true });
    return Response.json({ success: true, data: result });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}
