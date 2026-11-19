---
name: Project cleanup (memory + sessions)
description: How to clean a project's Claude auto-memory store and its Claude Code session transcripts — run when memory is bloated/stale or sessions have piled up. Covers arrange + redundancy removal for memory, and `project --autoclean` for sessions.
---

# Project cleanup × use-code-cli

Two unrelated cleanups live under one roof:

1. **Memory cleanup** — the Claude auto-memory store (`~/.claude/projects/<encoded-cwd>/memory/`): `MEMORY.md` index + per-memory `.md` files.
2. **Session cleanup** — Claude Code session transcripts for a project, via `use-code-cli project --autoclean`.

They are independent. Memory cleanup is manual/editorial; session cleanup is automated by the CLI.

## 1. Memory cleanup

### Layout

```
~/.claude/projects/<encoded-cwd>/memory/
├── MEMORY.md          # index: one line per memory, grouped by type
├── feedback_*.md      # type: feedback
├── project_*.md       # type: project
├── reference_*.md     # type: reference
└── *.md               # other (e.g. sox_earnings_dynamic.md)
```

Each memory file has YAML frontmatter (`name`, `description`, `metadata.type`) and a body. `MEMORY.md` is the index loaded into every session's context — keep it lean.

### Step A — Arrange the index

- Group entries by type: Feedback / Project / Reference.
- One line per memory: `- [Title](file.md) — <one-sentence hook>`.
- Hooks must be one sentence; collapse multi-paragraph summaries into the single clearest phrasing.
- Sort within a group (by date descending or topic).
- Remove dangling references to deleted files.
- Deduplicate: each memory appears exactly once.

### Step B — Clean out-of-date / redundant content

Apply content-redundancy removal (cut duplicates, obvious filler, stale statements; **preserve meaning and unique signal**):

1. Identify superseded entries — a later memory in the same lineage captures the current state (e.g. `rf-gate-phase2` → `rf-meta-straddle-fix`).
2. Before deleting a superseded entry, **merge its unique details** into the surviving (latest) entry as a "Historical context" section. Never delete unique information.
3. Delete the superseded file and remove its index line.
4. For bloated accumulated files (multi-round research logs), trim only clearly redundant content (duplicate statements, filler). If each round adds distinct info, leave it intact — do not guess away signal.
5. When unsure whether content is redundant or load-bearing, keep it and flag for review.

### Safety rules

- Memory files are not git-tracked — there is no undo. Back up before destructive edits if in doubt.
- Never delete a memory whose unique finding is not captured elsewhere.
- "Killed/dead" decision records (falsified hypotheses, no-signal results) are load-bearing: they prevent re-doing dead work. Keep them.
- Verify after: file count == index entry count, no duplicate index lines, no dangling references.

## 2. Session cleanup (`project --autoclean`)

Cleans old Claude Code session transcripts for a project, keeping only the most recent N (default 50).

### Command surface

| Flag | Meaning |
|---|---|
| `--autoclean` | Enable cleanup mode (otherwise `project` just shows project info) |
| `--keep N` | Keep the N most-recent sessions (default 50; must be ≥ 1) |
| `--project <path>` / positional target | Project workspace path, dir name, or unique path suffix (default: cwd) |
| `--dry-run` | Report what would be deleted, without deleting |
| `--yes` | Delete without stopping at the confirmation gate |

Invocation: `use-code-cli project <target> --autoclean [--keep N] [--dry-run] [--yes]`

### Behaviour

1. Resolve the project (ambiguous match → error listing candidates; unknown path that exists as a directory → treat as a new project).
2. List all sessions for that project; split into **active** (online) and **inactive**.
3. If active sessions already reach `keep`, nothing is deleted — active sessions are never removed.
4. Otherwise reserve `keep - active` slots for the most-recent inactive sessions (by transcript mtime, falling back to `updatedAt`).
5. Everything older is a deletion candidate, but only if its transcript lives inside the project's directory — sessions whose transcript is elsewhere are skipped.
6. Without `--yes` (and not `--dry-run`), refuse and print the would-delete list — re-run with `--yes` to proceed.
7. Delete transcript files and remove the deleted IDs from the session-name registry (best effort).

### Safety

- Active sessions are never deleted.
- `--dry-run` previews without touching files.
- The confirmation gate (`--yes` required) prevents accidental mass deletion.
- Transcripts outside the project directory are skipped, so cross-project data is safe.
- Keep `--keep` ≥ 1 (validated; `keep must be a positive integer >= 1`).

### Typical workflow

```bash
# 1. Preview
use-code-cli project use-stock --autoclean --dry-run

# 2. Confirm and delete
use-code-cli project use-stock --autoclean --yes

# 3. Keep more (e.g. 100) of a busy project
use-code-cli project use-stock --autoclean --keep 100 --yes
```

## When to run which

| Symptom | Use |
|---|---|
| `MEMORY.md` bloated / stale findings / duplicate index lines | Memory cleanup (Section 1) |
| Hundreds of old session transcripts piling up | `project --autoclean` (Section 2) |
| Both | Run memory cleanup first (editorial), then autoclean sessions |
