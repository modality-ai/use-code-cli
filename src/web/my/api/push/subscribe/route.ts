import { addSubscription } from "../../../../../lib/push-subscriptions";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const endpoint = body?.endpoint;
    const keys = body?.keys;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return Response.json({ success: false, error: "invalid subscription" }, { status: 400 });
    }
    await addSubscription({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: request.headers.get("user-agent") ?? undefined,
      createdAt: Date.now(),
    });
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}