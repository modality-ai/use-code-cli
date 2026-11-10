import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { loadStore, saveStore, toUint8Array, base64ToBuf } from "../../store";
import { consumeChallenge } from "../../challenge";
import { getRpConfig, issueSession, setSessionCookie } from "../../../../../lib/web/auth";

export async function POST(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch {}
  const response = body?.response || body;
  const challengeId = body?.challengeId || "latest";
  try {
    const store = await loadStore();
    if (!store) return Response.json({ success: false, error: "no user registered" }, { status: 400 });
    const { rpID, origin } = getRpConfig(request);
    let expectedChallenge = consumeChallenge(challengeId);
    if (!expectedChallenge && challengeId !== "latest") {
      expectedChallenge = consumeChallenge("latest");
    }
    if (!expectedChallenge) {
      return Response.json({ success: false, error: "challenge not found or expired" }, { status: 400 });
    }
    const cred = store.credentials.find((c) => c.id === response?.id);
    if (!cred) return Response.json({ success: false, error: "credential not found" }, { status: 400 });
    if (cred.rpId && cred.rpId !== rpID) return Response.json({ success: false, error: "credential not valid for this host" }, { status: 400 });
    if (!cred.rpId && rpID !== "localhost") return Response.json({ success: false, error: "credential not valid for this host" }, { status: 400 });
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: toUint8Array(base64ToBuf(cred.publicKey)) as any,
        counter: cred.counter,
        transports: cred.transports,
      },
    });
    if (!verification.verified) {
      return Response.json({ success: false, error: "verification failed" }, { status: 400 });
    }
    cred.counter = verification.authenticationInfo.newCounter;
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