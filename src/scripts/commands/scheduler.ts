import { z } from "zod";
import { isJsonMode, optionalValueFlag, renderTable, type CLICommand } from "modality-cli-kit";
import { loadTasks } from "../../runner/scheduler";
import { scan } from "../scheduler-tasks/second";

const SchedulerArgsSchema = z.object({
  dir: z.string().optional().describe("Target folder containing task modules"),
  run: optionalValueFlag("").describe("Run tasks once. Bare = all; pass a file path to run only that module."),
  target: z.string().optional().describe("Specific task/module file to run (suppresses listing)"),
});

type SchedulerArgs = z.infer<typeof SchedulerArgsSchema>;

async function scheduler(args: SchedulerArgs) {
  const tasks = await loadTasks(args.dir);
  const secondModules = await scan();

  const runArg = args.run === undefined || args.run === "" ? undefined : args.run;
  const runTarget = args.target ?? (typeof runArg === "string" && runArg.length > 0 ? runArg : undefined);
  const runAll = args.run === "";

  const matchFile = (n: string) => !runTarget || n.endsWith(runTarget) || n === runTarget;
  const runTasksList = tasks.filter((t) => matchFile(t.name));
  const runSecondList = secondModules.filter((m) => matchFile(m.name));

  if (runTarget || runAll || args.run !== undefined) {
    for (const t of runTasksList) {
      try { await t.run(); } catch { /* swallow */ }
    }
    for (const m of runSecondList) {
      try { await m.run(); } catch { /* swallow */ }
    }
  }

  const hasArgs = Boolean(args.dir) || args.run !== undefined || Boolean(args.target);
  const showTables = !hasArgs;
  if (!isJsonMode() && showTables) {
    console.log("First-granularity tasks:");
    if (tasks.length > 0) {
      renderTable(["name", "schedule", "intervalMs"], tasks.map((t) => [t.name, t.schedule ?? "—", t.intervalMs != null ? String(t.intervalMs) : "—"]));
    } else {
      console.log("  (none)");
    }
    console.log();
    console.log("Second-granularity modules:");
    if (secondModules.length > 0) {
      renderTable(["name", "schedule", "timeZone"], secondModules.map((m) => [m.name, m.schedule ?? "—", m.timeZone ?? "—"]));
    } else {
      console.log("  (none)");
    }
  }

  return {
    success: true,
    data: {
      first: tasks.map((t) => ({ name: t.name, schedule: t.schedule ?? null, intervalMs: t.intervalMs ?? null })),
      second: secondModules.map((m) => ({ name: m.name, schedule: m.schedule ?? null, timeZone: m.timeZone ?? null })),
    },
  };
}

export const schedulerCommand: CLICommand = {
  name: "scheduler",
  description: "Debug scheduler: list discovered tasks and armed cron expressions",
  inputSchema: SchedulerArgsSchema,
  positionalKeys: ["target"],
  execute: scheduler,
  examples: ["use-code-cli scheduler", "use-code-cli scheduler --run", "use-code-cli scheduler --run src/scripts/scheduler-second/session-status.ts"],
};
