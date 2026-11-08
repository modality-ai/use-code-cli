---
name: Loop backfill for agent supervision
description: How to use /loop as a backfill when Monitor is not suited for supervising other Claude Code sessions.
---

# /loop backfill × use-code-cli

Monitor is the primary wake signal, but use `/loop` as backfill when Monitor is not suited: nesting forbidden, arm failure, or polling cadence needed.

## Example

```
/loop 5m execute `!use-code-cli sessions` to find any idle hero in this project, then reassign the job to them.
```

Every 5 minutes, list sessions, find an idle hero in this project, and reassign the job to them.

## Notes

- Prefer 270s+ cadences to stay in the prompt cache; use 1200s+ when nothing is moving.
- Never nest monitors; `/loop` is the fallback, not a second monitor.
- Stop when the work is done: `ScheduleWakeup` with `stop: true`.