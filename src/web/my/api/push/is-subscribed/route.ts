import { isSubscribed } from "../../../../../lib/push-subscriptions";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const endpoint = url.searchParams.get("endpoint");
    if (!endpoint) {
      return Response.json({ success: false, error: "endpoint required" }, { status: 400 });
    }
    const subscribed = await isSubscribed(endpoint);
    return Response.json({ success: true, subscribed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
