import { clearSessionCookie } from "../../../../lib/web/auth";

export async function POST(request: Request): Promise<Response> {
  const host = new URL(request.url).host;
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(host),
    },
  });
}