import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { loadStore } from "../../store";
import { saveChallenge } from "../../challenge";
import { getRpConfig } from "../../../../../lib/web/auth";
import { randomBytes } from "node:crypto";

export async function POST(request: Request): Promise<Response> {
  try {
    const store = await loadStore();
    const { rpID } = getRpConfig(request);
    const allowCredentials = (store?.credentials || [])
      .filter((c) => c.rpId === rpID || (!c.rpId && rpID === "localhost"))
      .map((c) => ({
        id: c.id,
        type: "public-key" as const,
        transports: c.transports,
      }));
    if (allowCredentials.length === 0) {
      return Response.json({ success: false, error: "no passkey registered for this host; register one first" }, { status: 400 });
    }
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      allowCredentials,
      userVerification: "preferred",
    });
    const challengeId = randomBytes(16).toString("hex");
    saveChallenge(challengeId, options.challenge);
    saveChallenge("latest", options.challenge);
    return Response.json({ success: true, options, challengeId });
  } catch (e) {
    return Response.json({ success: false, error: String(e) }, { status: 500 });
  }
}