import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getOrCreateUser, saveStore, bufToBase64 } from "../../store";
import { consumeChallenge } from "../../challenge";
import { getRpConfig, issueSession, setSessionCookie } from "../../../../../lib/web/auth";

export async function POST(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch {}
  const response = body?.response || body;
  const challengeId = body?.challengeId || "latest";
  try {
    const store = await getOrCreateUser();
    const setupToken = body?.setupToken || new URL(request.url).searchParams.get("token") || request.headers.get("x-setup-token");
    const expected = process.env.PASSKEY_SETUP_TOKEN || process.env.WEBAUTHN_SETUP_TOKEN;
    const { rpID, origin } = getRpConfig(request);
    const hasForHost = (store.credentials || []).some((c) => c.rpId === rpID);
    if (hasForHost) {
      if (!expected || setupToken !== expected) {
        return Response.json({ success: false, error: "registration locked; setup token required" }, { status: 403 });
      }
    }
    let expectedChallenge = consumeChallenge(challengeId);
    if (!expectedChallenge && challengeId !== "latest") {
      expectedChallenge = consumeChallenge("latest");
    }
    if (!expectedChallenge) {
      return Response.json({ success: false, error: "challenge not found or expired" }, { status: 400 });
    }
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return Response.json({ success: false, error: "verification failed" }, { status: 400 });
    }
    const { credential } = verification.registrationInfo;
    store.credentials.push({
      id: credential.id,
      publicKey: bufToBase64(credential.publicKey),
      counter: credential.counter,
      transports: (response?.response?.transports || body?.transports) as any,
      rpId: rpID,
    });
    await saveStore(store);
    const token = await issueSession(store.userName);
    const host = new URL(request.url).host;
    return new Response(JSON.stringify({ success: true, verified: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": setSessionCookie(token, host),
      },
    });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}