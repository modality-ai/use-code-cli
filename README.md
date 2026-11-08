# `use-code-cli`

> Talk to other Claude Code sessions — one-to-one or **broadcast to many**. Regular `claude` CLI only ever talks one-to-one; `use-code-cli` can reach every active session at once.

## Why

Claude Code's built-in tooling only ever delivers a message to a single peer. `use-code-cli` removes that ceiling:

- **`talk`** — deliver a message to one session (with reply instructions, `---` literal mode, `--one-way`, `--in-reply-to`).
- **`talk-to-all`** — deliver one message to **every** matching session in a single shot. Filter by name, status, or hero. This is the killer feature: one command, N agents.
- **`talk-permit`** — gate inbound cross-session messages: show or set `crossSessionInbound` (`accept` | `hold` | `refuse` | `unset`) in `~/.claude/settings.json`, so a session controls whether — and how — other sessions can reach it.

## Usage

```bash
use-code-cli <command> [args]
```

---

## ⭐ `talk` — one-to-one

Deliver a message to another active Claude Code session.

```bash
use-code-cli talk [target] "message" [--one-way] [--in-reply-to <msg_id>]
```

`target` is a session name, pid, or sessionId; omit it when exactly one other session is active.

### Reply instructions

By default the message ends with a reply instruction naming the session that launched the CLI:

```
When you're done, report back with use-code-cli talk <sender> "<your answer>" --one-way
```

`<sender>` is the session that sent the request and `<your answer>` is the text to deliver. The `--one-way` in that instruction is deliberate: the answer is terminal, so the peer's reply carries no instruction of its own and two sessions cannot bounce messages back and forth forever. The sender name comes from the session running the command. If it cannot be determined, the instruction is skipped and the command reports it.

The instruction is on by default; pass `--one-way` to send the message without it, exactly as written.

Every annotated message also carries an invisible marker with the reply hop and its own id:

```
<!-- use-code-cli:auto-reply hop=1 id=<msg_id> -->
```

A message that already carries the marker is an automatic reply and is never annotated again. A message that already contains a real reply instruction (`--one-way` or `--in-reply-to`) is left untouched too, so the hint is never appended twice. A bare mention of `use-code-cli talk` — for example a quoted log — does not count as an instruction.

### Answering by id

Pass `--in-reply-to <msg_id>` when the message answers another one. The id is recorded in `~/.use-code-cli/talk-replies.json`, and a second answer to the same id delivered to the same session is refused — one inbound message gets one answer, even when an agent retries or two relays race. Pass `--force` to send anyway.

### The `---` separator

For messages that are awkward to quote, everything after the first `---` is taken as the message:

```bash
use-code-cli talk <target> [flags] --- the rest is the message
```

The tokens are joined with single spaces and kept verbatim: flags after the separator are ordinary text, and a later `---` is part of the message. Flags before it still apply, and the target stays optional — `talk --- hello` auto-picks the only active session.

With nothing after `---`, the message is read from stdin, which avoids shell parsing entirely:

```bash
use-code-cli talk worker --- <<'EOF'
Line one with "quotes" and $VAR left alone.
EOF

use-code-cli talk worker --- < message.txt
```

**The shell still expands unquoted words before the CLI sees them**: `$VAR`, backticks, globs and (in interactive bash) `!` are expanded by the shell in the inline form. The separator protects text from the CLI's flag parser, not from the shell. For fully literal text use the stdin form above; a quoted heredoc is the safest.

An empty message — nothing after `---` and empty stdin, or a terminal on stdin — is an error.

---

## ⭐ `talk-to-all` — broadcast to many

Deliver **one message to every matching session** in a single command. This is what a plain `claude` CLI cannot do.

```bash
use-code-cli talk-to-all <message> [--filter-name a,b] [--filter-status busy,idle] [--self]
```

One invocation, N recipients. Filter by name or status; add `--self` to include the sender. Ideal for dispatching a task, a nudge, or a status request across a whole team of agents at once.

---

## `talk-hero`

Deliver a message to the first active session in this project whose deployed hero matches a keyword.

```bash
use-code-cli talk-hero <hero> "message" [--one-way] [--in-reply-to <msg_id>]
```

---

## `session`

Show one session's workspace, hero, git branch, transcript, and cron jobs.

```bash
use-code-cli session <target>
```

`target` is a session name, pid, or sessionId (a unique name prefix also works). The cron block is recovered from the transcript, since Claude Code keeps cron jobs in memory only: every job a `CronCreate` result assigned an id to, minus every job a `CronDelete` confirmed. A job that already fired or passed its 7-day expiry can still be listed. With `--json`, the rows include a `talk` command an agent can run verbatim (`null` when the session is offline) and a `crons` array with each job's id, cron expression, human schedule, prompt, and creation time.

### Renaming

`use-code-cli session <target> --rename <name>` pins a name on the session. The name is written to `~/.claude/sessions/names.json` keyed by the session id, so it survives the session ending and wins over Claude Code's derived name. `use-code-cli session <target> --cwd <dir>` moves the transcript into the project directory for `<dir>`.

### Compacting

`use-code-cli compact <target>` rewrites the session's transcript in place, trimming bulky tool results and payloads down to a bounded size while keeping every line valid JSON, so Claude Code can still resume the session. It reports the byte reduction. Pass `--summary "..."` to replace the transcript with a compacted summary (like `/compact`), letting an LLM agent supply the recap text.

---

## `sessions`

List active (and offline) sessions.

```bash
use-code-cli sessions [--all] [--filter-status busy,idle] [--filter-name a,b] [--recent N] [--search text]
```

---

## `prompts`

List the prompts sessions received, or search only prompts — assistant replies and tool output are never matched.

```bash
use-code-cli prompts [target] [search] [--search <text>] [--filter-name <names>] [--filter-status <statuses>] [--limit <n>]
```

---

## `monitors`

List background monitors recovered from session transcripts (read-only).

```bash
use-code-cli monitors [target] [--all] [--search <text>] [--filter-name <names>] [--filter-status <statuses>] [--filter-hero <names>] [--limit <n>]
```

Monitors are session-only (they live in the Claude Code process), so this command can only *report* them — it cannot create, update, or delete them. Create/stop monitors from inside the session with Claude Code's `Monitor` / `TaskStop` tools.

---

## `memory`

List Claude Code's persistent agent memory files, or search their content.

```bash
use-code-cli memory [search] [--files] [--limit <n>]
```

---

## Dev server

Run `bun start` then open http://127.0.0.1:3000/sessions for a JSON list of sessions.

## Repository

-   `GIT` — https://github.com/use-code-cli
-   `NPM` — https://www.npmjs.com/package/use-code-cli