import { getVapidKeys } from "../../../../../lib/vapid";

export async function GET(): Promise<Response> {
  const keys = getVapidKeys();
  return Response.json({ publicKey: keys.publicKey });
}