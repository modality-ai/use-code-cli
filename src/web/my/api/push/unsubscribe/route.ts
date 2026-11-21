import { removeSubscription } from "../../../../../lib/push-subscriptions";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const endpoint = body?.endpoint;
    if (!endpoint) {
      return Response.json({ success: false, error: "endpoint required" }, { status: 400 });
    }
    await removeSubscription(endpoint);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}