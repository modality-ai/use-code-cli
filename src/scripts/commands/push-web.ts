import { z } from "zod";
import type { CLICommand } from "modality-cli-kit";
import { notifyAll, notifyOne } from "../../lib/push-notify";
import { listSubscriptions } from "../../lib/push-subscriptions";

const PushWebArgsSchema = z.object({
  message: z
    .string()
    .optional()
    .describe("Custom message body to send (default: 'Test notification from server')"),
  to: z
    .string()
    .optional()
    .describe("Target a single subscription by index or endpoint substring"),
  list: z
    .boolean()
    .optional()
    .default(false)
    .describe("List subscribed devices without sending a push"),
});

type PushWebArgs = z.infer<typeof PushWebArgsSchema>;

async function pushWeb(args: PushWebArgs) {
  const title = "use-code-cli";
  try {
    if (args.list) {
      const subs = await listSubscriptions();
      const out = subs.map((s, i) => ({ index: i, endpoint: s.endpoint, userAgent: s.userAgent ?? null }));
      console.log(JSON.stringify(out, null, 2));
      return { success: true };
    }
    const body = args.message && args.message.trim() ? args.message : "Test notification from server";
    if (args.to) {
      const subs = await listSubscriptions();
      let idx = -1;
      if (/^\d+$/.test(args.to)) {
        idx = Number(args.to);
      } else {
        idx = subs.findIndex((s) => s.endpoint.includes(args.to as string));
      }
      if (idx < 0 || idx >= subs.length) {
        const out = { ok: false, error: `Subscription not found: ${args.to}` };
        console.log(JSON.stringify(out));
        return { success: false, message: JSON.stringify(out) };
      }
      const sub = subs[idx]!;
      await notifyOne(sub, title, body);
      const out = { ok: true, to: idx, endpoint: sub.endpoint };
      console.log(JSON.stringify(out));
      return { success: true, message: JSON.stringify(out), data: out };
    }
    await notifyAll(title, body);
    const out = { ok: true };
    console.log(JSON.stringify(out));
    return { success: true, message: JSON.stringify(out), data: out };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const out = { ok: false, error: reason };
    console.log(JSON.stringify(out));
    return { success: false, message: reason };
  }
}

export const pushWebCommand: CLICommand = {
  name: "push-web",
  description: "Trigger a test push notification to all or one subscribed device, or list subscriptions.",
  inputSchema: PushWebArgsSchema,
  positionalKeys: ["message"],
  execute: pushWeb,
  examples: [
    "use-code-cli push-web",
    "use-code-cli push-web hihi",
    "use-code-cli push-web hihi --to 0",
    "use-code-cli push-web --list",
  ],
};
