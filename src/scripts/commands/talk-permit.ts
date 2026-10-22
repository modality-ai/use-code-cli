import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rename } from "node:fs/promises";
import type { CLICommand } from "modality-cli-kit";

const KEY = "crossSessionInbound";
const VALUES = ["accept", "hold", "refuse", "unset"] as const;

const InboundArgsSchema = z.object({
  value: z
    .enum(VALUES)
    .optional()
    .describe("accept | hold | refuse | unset (omit to show the current value)"),
});

type InboundArgs = z.infer<typeof InboundArgsSchema>;

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

async function readSettings(): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(SETTINGS_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  if (text.trim() === "") return {};
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${SETTINGS_PATH} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function inbound(args: InboundArgs) {
  let settings: Record<string, unknown>;
  try {
    settings = await readSettings();
  } catch (err) {
    return { success: false, message: `Cannot read settings: ${(err as Error).message}` };
  }

  const current = settings[KEY];
  if (args.value === undefined) {
    return {
      success: true,
      message: `${KEY}: ${current === undefined ? "(unset)" : String(current)}`,
      data: { value: current ?? null },
    };
  }

  if (args.value === "unset") delete settings[KEY];
  else settings[KEY] = args.value;

  // Write atomically so a crash cannot corrupt the user's settings.
  const tmp = `${SETTINGS_PATH}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmp, SETTINGS_PATH);

  return {
    success: true,
    message: `${KEY} ${args.value === "unset" ? "removed" : `set to "${args.value}"`} in ${SETTINGS_PATH}. Applies to sessions started afterwards.`,
    data: { previous: current ?? null, value: args.value === "unset" ? null : args.value },
  };
}

export const talkPermitCommand: CLICommand = {
  name: "talk-permit",
  aliases: ["send-permit", "permit"],
  description: "Show or set crossSessionInbound in ~/.claude/settings.json (accept | hold | refuse | unset)",
  inputSchema: InboundArgsSchema,
  positionalKeys: ["value"],
  execute: inbound,
  examples: ["use-code-cli talk-permit", "use-code-cli talk-permit accept", "use-code-cli talk-permit unset"],
};
