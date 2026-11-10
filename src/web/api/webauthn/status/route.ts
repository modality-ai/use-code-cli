import { requireAuth, getRpConfig } from "../../../../lib/web/auth";
import { loadStore } from "../store";

export async function GET(request: Request): Promise<Response> {
  const { rpID } = getRpConfig(request);
  const store = await loadStore();
  const hasCredentials = (store?.credentials || []).some((c) => c.rpId === rpID || (!c.rpId && rpID === "localhost"));
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return Response.json({ success: true, authenticated: false, hasCredentials });
  }
  return Response.json({ success: true, authenticated: true, user: auth.payload.sub, hasCredentials });
}