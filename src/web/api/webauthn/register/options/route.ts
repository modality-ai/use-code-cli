import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getOrCreateUser } from "../../store";
import { saveChallenge } from "../../challenge";
import { getRpConfig } from "../../../../../lib/web/auth";
import { APP_NAME } from "../../../../../config/constants";
import { randomBytes } from "node:crypto";

export async function POST(request: Request): Promise<Response> {
  try {
    const store = await getOrCreateUser();
    const token = new URL(request.url).searchParams.get("token") || request.headers.get("x-setup-token");
    const expected = process.env.PASSKEY_SETUP_TOKEN || process.env.WEBAUTHN_SETUP_TOKEN;
    const { rpID, origin } = getRpConfig(request);
    const hasForHost = (store.credentials || []).some((c) => c.rpId === rpID);
    if (hasForHost) {
      if (!expected || token !== expected) {
        return Response.json({ success: false, error: "registration locked; setup token required" }, { status: 403 });
      }
    }
    const rpName = APP_NAME;
    const raw = Buffer.from(store.userId, "base64url");
    const uid = raw.length ? new Uint8Array(raw) : new Uint8Array(randomBytes(16));
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: uid,
      userName: store.userName,
      userDisplayName: store.displayName,
      timeout: 60000,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    const challengeId = randomBytes(16).toString("hex");
    saveChallenge(challengeId, options.challenge);
    // also save under a default key for clients that don't echo id
    saveChallenge("latest", options.challenge);
    return Response.json({ success: true, options, challengeId, rpID, origin });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}