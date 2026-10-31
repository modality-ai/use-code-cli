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

### `session`

Show one session's workspace, hero, git branch, transcript, and cron jobs.

```bash
use-code-cli session <target>
```

`target` is a session name, pid, or sessionId (a unique name prefix also
works). The cron block is recovered from the transcript, since Claude Code
keeps cron jobs in memory only: every job a `CronCreate` result assigned an id
to, minus every job a `CronDelete` confirmed. A job that already fired or
passed its 7-day expiry can still be listed. For an offline session the block
shows the last known jobs, which died with that session. With `--json`, the
rows include a `talk` command an agent can run verbatim (`null` when the
session is offline) and a `crons` array with each job's id, cron expression,
human schedule, prompt, and creation time.

### Renaming

`use-code-cli session <target> --rename <name>` pins a name on the session.
The name is written to `~/.claude/sessions/names.json` keyed by the session id, so
it survives the session ending and wins over Claude Code's derived name —
renaming an offline session keeps it addressable afterwards. The rename is also
mirrored into the session's transcript, so `claude --resume <name>` resolves it
(run it from the session's project directory; in the picker, press Ctrl+A to
search all projects).

`use-code-cli session <target> --cwd <dir>` moves the session's transcript into
the project directory for `<dir>`, so `claude --resume` (by name or id) works
when run from that directory. Combine with `--rename` to do both at once.

### `prompts`

List the prompts sessions received, or search only prompts — assistant replies
and tool output are never matched.

```bash
use-code-cli prompts [target] [search] [--search <text>] [--filter-name <names>] [--filter-status <statuses>] [--limit <n>]
```

`target` is a session name, pid, or sessionId (a unique name prefix also
works); with it, only that session's prompts are read and the session filters
are ignored. A second positional is the search term, so
`use-code-cli prompts use-design-da deploy` and
`use-code-cli prompts use-design-da --search deploy` are the same.

Without `--search`, the newest 20 prompts across every known session (online
and offline) are shown, newest first; `--limit` changes the count. `--search`
matches typed prompts and cross-session messages case-insensitively and shows
every match unless `--limit` is set. `--filter-name` / `--filter-status` narrow
the sessions read, using the same syntax as `sessions`.

Each line carries the session's name, the prompt kind (`typed` or `peer`), and
the prompt text. With `--json`, the rows also include the transcript line
number and full prompt text.

### `memory`

List Claude Code's persistent agent memory files, or search their content.

```bash
use-code-cli memory [search] [--files] [--limit <n>]
```

Without `--search`, the newest 20 memory files are listed, newest first, each
with its project workspace and a one-line summary (the frontmatter
`description`, else the first line of the body). `--limit` changes the count.
The search term can also be positional, so `use-code-cli memory deploy` and
`use-code-cli memory --search deploy` are the same.

`--search` matches a file's whole content case-insensitively and shows every
match unless `--limit` is set, reporting the occurrence count, the line number
of the first hit, and that line. Files are read from
`~/.claude/projects/<project>/memory/` (recursively) across every known
project; nothing outside those memory directories is searched.

`--files` prints every file as a single path per line, with the home prefix
shortened to `~` — no timestamp, project, or summary line. It ignores the
default 20-file limit, and an explicit `--limit` caps the list without printing
a "hidden" footer, so the output stays one path per line. Pair it with a search
to list only the files that match:

```bash
use-code-cli memory --files | xargs -n1 less
use-code-cli memory deploy --files
```

Each heading line of the normal listing carries the file's timestamp, the
project workspace, and its path inside the memory directory. With `--json`,
rows also include the encoded project directory and the absolute file path.

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

The instruction is on by default; pass `--one-way` to send the message without
it, exactly as written.

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

