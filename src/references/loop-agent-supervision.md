---
name: Loop-driven agent supervision
description: How to run a /loop tick that supervises other Claude Code sessions with use-code-cli — load when the user asks to watch, poll, nudge, or escalate agents on a cadence.
---

# /loop × use-code-cli

`/loop` re-runs a prompt on a cadence. `use-code-cli` reads and writes other Claude Code sessions. Together they form a supervisor that checks work, nudges, escalates, and stops — without a human polling.

## 1. Choose the cadence

| Form | Behaviour | When |
|---|---|---|
| `/loop 5m <prompt>` | fixed interval | you know how fast the work moves |
| `/loop <prompt>` | self-paced (dynamic) | the tick itself decides when to look again |

- 60s is the floor. 270s keeps the prompt cache warm. Use 1200s+ when nothing changes quickly; avoid 300s — it pays the cache miss without buying a long wait.
- Never nest: supervised sessions must not run `/loop` themselves.
- Write the tick prompt so a fresh tick can act alone: what to read, how to decide, when to stop.

## 2. Command surface

| Command | What it gives you |
|---|---|
| `use-code-cli sessions [--all] [--filter-status busy,idle] [--filter-name a,b] [--recent N] [--search text]` | every active session: name, hero, status, cwd, last prompt |
| `use-code-cli session <target> --json` | one session: workspace, hero, transcript path |
| `use-code-cli prompts [target] [search] [--limit N]` | what each session was asked, in order |
| `use-code-cli talk [target] --- <message> [--one-way] [--in-reply-to <msg_id>]` | deliver a message; `---` or stdin keeps the text literal |
| `use-code-cli talk-to-all <message> [--filter-name a,b] [--filter-status busy,idle] [--self]` | one message to many sessions |
| `use-code-cli talk-permit [accept\|hold\|refuse\|unset]` | cross-session inbound policy |

`talk <session> "<text>"` (quoted, no `---`) appends a reply instruction, so the agent may answer back. Use `---` or `--one-way` when the text must arrive exactly as written.

Sessions JSON: `{ success, data: [{ name, hero, status, cwd, sessionId, lastPrompt, ... }] }`.

## 3. One tick, five steps

```bash
# 1. read
use-code-cli sessions --json

# 2. diff — objective evidence, not the agent's own claims
git -C <cwd> status --porcelain
ls -lt <key files>

# 3. classify
#    busy  + new files  → leave alone, reset idle counter
#    busy  + no files   → nudge once (no idle count)
#    idle  + no files   → idle counter += 1

# 4. act
use-code-cli talk <session> --- "<message>"              # literal; stdin for long text
use-code-cli talk <session> --- "<message>" --one-way   # no reply expected

# 5. stop check
#    work done → end /loop or delete its cron entry
```

Keep the idle counter outside the prompt (a small JSON file under `/tmp`, keyed by session name). A tick that forgets the count can never escalate.

## 4. Read progress cheaply

```bash
use-code-cli session <name> --json     # includes the transcript path
use-code-cli prompts <name> --limit 5  # what it was asked, in order
```

Before calling an agent idle, check its transcript for transport failures:

```bash
grep -c "API Error\|missing access_token" <transcriptPath>
```

A session that died on an auth error looks identical to an idle one in `sessions`. Fix the cause (usually `/login` in that terminal) and re-send the task instead of starting a new agent.

## 5. Escalation ladder

| Consecutive idle ticks | Action |
|---|---|
| 1 | Nudge: ask for the missing deliverable, naming the file or artefact expected |
| 2 | Ask what blocks it: missing input, missing approval, or not doable — then supply it |
| 3+ | Report the blocker and the handling to the owner; the work stays with the same agent |

Never re-assign the work to another session, and never ask a peer to perform something your own session was denied.

## 6. Stop conditions

A supervision loop ends when the deliverable exists and its acceptance checks pass, the owner cancels it, or it has reported the same blocker for three ticks and is waiting on a human.

Stop by ending `/loop` (dynamic mode: `ScheduleWakeup` with `stop: true`) or deleting the cron job. A loop with nothing to say still costs a full turn — report "no change" in one line instead of re-running the whole test suite.
