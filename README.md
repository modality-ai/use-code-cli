# `use-code-cli`

> TODO: description

## Repository

-   `GIT`
    -   https://github.com/use-code-cli
-   `NPM`
    -   https://www.npmjs.com/package/use-code-cli

## Usage

```bash
use-code-cli <command> [args]
```

### `talk`

Deliver a message to another active Claude Code session.

```bash
use-code-cli talk [target] "message" [--no-reply]
```

`target` is a session name, pid, or sessionId; omit it when exactly one other
session is active.

By default the message ends with a reply instruction naming the session that
launched the CLI:

```
When you're done, report back with use-code-cli talk <sender>
```

The sender name comes from the session running the command. If it cannot be
determined, the instruction is skipped and the command reports it. Messages that
already contain a `use-code-cli talk` instruction are left untouched, so the
hint is never appended twice.

Pass `--no-reply` to send the message exactly as written.

