const NAMES = new Set(["project-run", "project-exec", "run-project"]);

export function preprocessProjectRunArgv(argv: string[]): { argv: string[] } {
  const commandName = argv[0];
  if (!commandName || !NAMES.has(commandName)) return { argv };

  const dashIdx = argv.findIndex((t) => t === "--" || t === "---");
  if (dashIdx !== -1) {
    const before = argv.slice(0, dashIdx);
    const cmdTokens = argv.slice(dashIdx + 1);
    const command = cmdTokens.join(" ").trim();
    if (!command) return { argv: before };
    return { argv: [...before, `--cmd=${command}`] };
  }

  const tokens = argv.slice(1);
  const flagTokens: string[] = [];
  const positionals: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith("-")) {
      flagTokens.push(t);
      if (!t.includes("=") && (t === "--project" || t === "--target")) {
        if (i + 1 < tokens.length) {
          flagTokens.push(tokens[++i]!);
        }
      }
    } else {
      positionals.push(t);
    }
  }

  const hasProjectFlag = flagTokens.some((f) => f.startsWith("--project") || f.startsWith("--target"));

  if (positionals.length === 0) {
    return { argv: [commandName, ...flagTokens] };
  }
  if (positionals.length === 1) {
    return { argv: [commandName, ...flagTokens, `--cmd=${positionals[0]}`] };
  }
  const target = positionals[0]!;
  const command = positionals.slice(1).join(" ");
  const newArgv = [commandName, ...flagTokens];
  if (!hasProjectFlag) newArgv.push(target);
  newArgv.push(`--cmd=${command}`);
  return { argv: newArgv };
}
