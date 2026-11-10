import { aiTool } from "../../../scripts/index";
import { resolveSessionTarget } from "../../my/session/[name]/session-data";

/**
 * The page sends a session's display name, but the talk command matches against
 * live session files whose stored name may be a derived pid-name. Resolve the
 * display name to a concrete pid/sessionId when possible, falling back to the
 * original name.
 */
export async function resolveTalkTarget(name: string): Promise<string> {
  try {
    const resolved = await resolveSessionTarget(name);
    if (resolved) return resolved;
  } catch {
    // fall through with the original name
  }
  return name;
}

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
    const target = await resolveTalkTarget(name);
    const result = await aiTool.execute({ command: "talk", target, message, "one-way": true });
    const ok = (result as any)?.success !== false;
    return Response.json({ success: ok, data: result });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}
