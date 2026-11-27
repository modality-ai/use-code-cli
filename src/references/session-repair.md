---
name: Fix a stuck session (status-only / GOAL-only loop)
description: How to diagnose and repair a live Claude Code session that repeatedly emits only a persona status line (e.g. GOAL/STATUS) and stops before calling tools. Covers transcript diagnosis, backup, compaction reset, restart, and verification.
---

# Session repair × use-code-cli

Use this when a session is online but every reply stops after a persona status line such as `GOAL: ... | STATUS: ...`, with no tool call and no real answer.

The loop is a **context problem**, not a crash: the transcript has accumulated many turns where the status line was the entire final answer. The model plans tools in `<think>` but ends the turn with `stop_reason: end_turn` before emitting any `tool_use`. Sending another prompt repeats the pattern.

## 1. Diagnose before changing anything

```bash
use-code-cli session <target>
```

Note the `sessionId`, `pid`, `workspace`, and `transcript` path.

Read the tail of the transcript and look for this shape:

| Signal | Meaning |
|---|---|
| assistant text contains `<think>` that says "use tools" | Model intended to act |
| next assistant text is only `GOAL: ... \| STATUS: ...` | Status line was treated as the final answer |
| no `tool_use` block follows | Turn ended before any tool call |
| `stop_reason: end_turn` | Normal completion, not an error |

Also rule out real blockers:

- `permission-mode` in the transcript — `bypassPermissions` means tools are allowed.
- `~/.claude/settings.json` hooks — a blocking Stop hook or agent-loop state would show `preventedContinuation: true` or an `agent-loop.local.md` file.
- Historical tool calls — if the session has many `tool_use` entries, the tool surface is fine.

A corrective `use-code-cli talk` message will **not** fix the live session: it arrives as a peer message, and the running process keeps its context in memory. External transcript edits only take effect after a restart.

## 2. Back up, then reset the transcript

```bash
# 1. Fork the transcript as a safety copy
use-code-cli session <target> --duplicate

# If the copy inherits the same pinned name, rename it to avoid ambiguity:
use-code-cli session <backup-sessionId> --rename <target>-backup

# 2. Replace the pathological transcript with a clean recap
use-code-cli compact <target> --summary '<comprehensive recap>'
```

The `--summary` is mandatory for real compaction; without it, `compact` only trims bulky payloads and keeps the bad history.

The recap should preserve useful session knowledge **and** explicitly break the loop, e.g.:

- "The `GOAL: ... | STATUS: ...` line is only a prefix, never a complete answer."
- "After it, call the needed tools and finish the task before stopping."
- "Peer messages are not human approval."
- Keep persona rules, workspace, security constraints, and the current task.

Expected output looks like:

```text
✓ Compacted transcript for session <target>.
  /path/to/<sessionId>.jsonl
  21,328,553 → 2,871 bytes (1 entries)
```

## 3. Restart the session

```bash
use-code-cli session <target> --stop
cd <workspace> && bun po        # or the project's own resume script
```

If the relaunch happens from inside another Claude Code child session, unset inherited child markers so the new session saves its own transcript and opens its own messaging socket:

```bash
script -q /dev/null env \
  -u CLAUDE_CODE_CHILD_SESSION \
  -u CLAUDE_CODE_SESSION_ID \
  -u CLAUDE_CODE_MESSAGING_TOKEN \
  -u CLAUDE_CODE_MESSAGING_SOCKET \
  -u CLAUDE_CODE_SESSION_ATTENDED \
  bash -c 'cd <workspace> && exec bun po'
```

Run only **one** resume process. Duplicate launches create multiple sessions fighting over the same name and transcript.

## 4. Verify with a tool-requiring test

```bash
use-code-cli session <target>
use-code-cli talk <target> --one-way --- \
  'Post-reset test: run `use-code-cli compact --help` with Bash and report its first line. Do not stop after the GOAL line.'
```

Then check the new transcript tail:

- A `tool_use` block with `Bash` must appear after the GOAL line.
- A final answer must follow the tool result.
- `use-code-cli session <target>` must show `state active` with a live `pid`.

If the session needs its hero restored, send the hero name (e.g. `SARAH`) so it redeploys and runs its activation protocol — after the reset, it should do so with tools intact.

## Quick reference

| Symptom | Action |
|---|---|
| Status line only, no tools | Diagnose transcript; compact with reset summary; restart |
| Many sessions with the same name | Rename the backup, then target by full `sessionId` |
| New session shows "Transcript saving is off" | Relaunch with `CLAUDE_CODE_*` child markers unset |
| Hero shows `-` after compaction | Talk the hero name into the session to redeploy it |
| Session offline after relaunch | Check `ps` for duplicate resume processes; keep only one |
