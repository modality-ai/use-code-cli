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
use-code-cli talk [target] "message" [--one-way] [--in-reply-to <msg_id>]
```

`target` is a session name, pid, or sessionId; omit it when exactly one other
session is active.

#### Reply instructions

By default the message ends with a reply instruction naming the session that
launched the CLI:

```
When you're done, report back with use-code-cli talk <sender> "<your answer>" --one-way
```

`<sender>` is the session that sent the request and `<your answer>` is the text
to deliver. The `--one-way` in that instruction is deliberate: the answer is
terminal, so the peer's reply carries no instruction of its own and two
sessions cannot bounce messages back and forth forever. The sender name comes
from the session running the command. If it cannot be determined, the
instruction is skipped and the command reports it.

The instruction is on by default, but a session that recently *received* an
automatic reply sends its next message without one, so loop safety does not
depend on the agent obeying the prose. Pass `--reply` to force it back on, or
`--one-way` to force it off.

Every annotated message also carries an invisible marker with the reply hop and
its own id:

```
<!-- use-code-cli:auto-reply hop=1 id=<msg_id> -->
```

A message that already carries the marker is an automatic reply and is never
annotated again. A message that already contains a real reply instruction
(`--one-way` or `--in-reply-to`) is left untouched too, so the hint is never
appended twice. A bare mention of `use-code-cli talk` — for example a quoted
log — does not count as an instruction.

#### Answering by id

Pass `--in-reply-to <msg_id>` when the message answers another one. The id is
recorded in `~/.use-code-cli/talk-replies.json`, and a second answer to the
same id delivered to the same session is refused — one inbound message gets
one answer, even when an agent retries or two relays race. Pass `--force` to
send anyway.

#### The `---` separator

For messages that are awkward to quote, everything after the first `---` is
taken as the message:

```bash
use-code-cli talk <target> [flags] --- the rest is the message
```

The tokens are joined with single spaces and kept verbatim: flags after the
separator are ordinary text, and a later `---` is part of the message. Flags
before it still apply, and the target stays optional — `talk --- hello`
auto-picks the only active session.

With nothing after `---`, the message is read from stdin, which avoids shell
parsing entirely:

```bash
use-code-cli talk worker --- <<'EOF'
Line one with "quotes" and $VAR left alone.
EOF

use-code-cli talk worker --- < message.txt
```

**The shell still expands unquoted words before the CLI sees them**: `$VAR`,
backticks, globs and (in interactive bash) `!` are expanded by the shell in the
inline form. The separator protects text from the CLI's flag parser, not from
the shell. For fully literal text use the stdin form above; a quoted heredoc is
the safest.

An empty message — nothing after `---` and empty stdin, or a terminal on stdin
— is an error.

#### Sending as written

Pass `--one-way` to send the message exactly as written.

