# User guide

Every command, with the output it actually produces. Run `gimlet-works --help` for
the same list without the commentary.

For one tool's arguments and a worked example, see the generated
[TOOL_REFERENCE.md](TOOL_REFERENCE.md) — it covers all of them.

- [First run](#first-run)
- [Tools](#tools)
- [Encryption](#encryption)
- [Keys](#keys)
- [Signatures](#signatures)
- [Metadata](#metadata)
- [The desktop app](#the-desktop-app)
- [Scripting](#scripting)
- [Troubleshooting](#troubleshooting)

## First run

```bash
gimlet-works doctor
```

`doctor` prints where state lives, what was found, and where the audit trail is:

```text
gimlet-works 1.2.0
platform    linux/aarch64
home        /home/you/.config/gimlet-works
config      /home/you/.config/gimlet-works/config.toml (defaults)
state dirs  ok
tools       26 total
  crypto       15
  privacy      3
  sysadmin     8
engine      built in (every tool runs in this process)
audit       /home/you/.config/gimlet-works/audit.jsonl (0 record(s))
```

There is no configuration to write before the first command: defaults are used
until you create one with `gimlet-works config init`.
Existing installations keep their old state root, and the `gimlet` command
remains available as an alias.

## Tools

```bash
gimlet-works tools list                 # the catalogue: id, category, writes, platforms
gimlet-works tools list --category crypto
gimlet-works tools show crypto.encrypt  # one manifest as JSON
```

Every tool is invoked the same way — `gimlet-works <tool> key=value …` — and every
tool takes the same global flags:

| Flag | Effect |
|---|---|
| `--format text\|json\|markdown\|csv\|html` | output shape; `--json` is shorthand |
| `--dry-run` | do everything except the write |
| `-v` | debug logging to stderr |

`html` writes one self-contained page — no script, no stylesheet, no request —
so a report can be filed or handed to someone who has no copy of the toolkit:

```bash
gimlet-works sysadmin.disk-usage --format html > disk.html
```

## The terminal surface

`gimlet-works tui` is the same catalogue, the same tools, and the same report contract
as the CLI and the desktop app, drawn in the terminal:

```bash
gimlet-works tui
```

Type to filter (`crypto key` narrows by every word), `↑`/`↓` to move, `enter` to
run the selected tool — argument-taking tools prompt for `key=value` pairs — and
`esc` to clear the filter or step back. Results scroll with `↑`/`↓` and page
with `pgup`/`pgdn`; `ctrl-c` quits. Runs started here are recorded in the audit
trail like any other, because the TUI calls the same `Runtime.run`.

`gimlet-works run <tool> …` is the explicit spelling; the shorthand form
(`gimlet-works system-info`) is an alias that resolves suffixes, so `sha256` finds
`crypto.sha256`.

## Encryption

Passphrase encryption, streaming, bounded memory:

```bash
export NOTES_PASS='correct horse battery staple'
gimlet-works crypto.encrypt input=notes.txt passphrase_env=NOTES_PASS
gimlet-works crypto.inspect input=notes.txt.gimlet
gimlet-works crypto.decrypt input=notes.txt.gimlet output=notes.clear.txt passphrase_env=NOTES_PASS
```

`passphrase_env` is preferred over `passphrase=` because an inline value lands in
shell history and in the process list. A wrong passphrase fails closed with
`decryption failed: wrong passphrase or corrupted file`; the two cases are
deliberately indistinguishable, and the file is never partially written.

Encrypting to a person instead of a secret:

```bash
gimlet-works crypto.encrypt input=notes.txt to=alice.pub        # version 3 container
gimlet-works crypto.decrypt input=notes.txt.gimlet key=alice.key   # alice's secret half
```

## Keys

Keys live in one sealed file, `$GIMLET_WORKS_HOME/keystore.gimlet`, opened with a
passphrase:

```bash
gimlet-works crypto.keygen kind=x25519 label=alice keystore=true passphrase_env=KEY_PASS
gimlet-works crypto.key-list passphrase_env=KEY_PASS
gimlet-works crypto.key-export selector=alice output=alice.pub passphrase_env=KEY_PASS
gimlet-works crypto.key-export selector=alice output=alice.key secret=true passphrase_env=KEY_PASS
gimlet-works crypto.key-import key=bob.pub label=bob public_only=true passphrase_env=KEY_PASS
gimlet-works crypto.key-rotate passphrase_env=KEY_PASS new_passphrase_env=KEY_PASS_2
```

`kind=ed25519` makes a signing key; `kind=x25519` makes a recipient key. Without
`keystore=true` the key is written as two files (`.key` and `.pub`), which is
what you want for a key you hand to someone.

Rotation re-seals the store — it does not regenerate keys, because that would
invalidate every signature already published.

## Signatures

```bash
gimlet-works crypto.keygen label=signer dir=~/keys
gimlet-works crypto.sign input=contract.txt key=~/keys/signer.key
gimlet-works crypto.verify input=contract.txt signature=contract.txt.sig key=~/keys/signer.pub
```

`sign` refuses to write over its input and refuses to replace an existing
signature without `overwrite=true`.

OpenPGP interop uses the system `gpg`:

```bash
gimlet-works crypto.gpg-verify input=release.tar signature=release.tar.asc
gimlet-works crypto.gpg-encrypt input=secret.txt recipient=alice@example.com
```

## Metadata

```bash
gimlet-works privacy.metadata-scan   input=photo.jpg
gimlet-works privacy.metadata-strip  input=photo.jpg profile=sharing
gimlet-works privacy.metadata-verify input=photo.clean.jpg
```

Profiles: `privacy` removes identity, text, and time; `sharing` keeps time;
`archive` removes nothing (pair it with `redact_gps=city`). `strip` writes a
`.clean` copy by default and writes through a temporary file, so an interrupted
run cannot truncate a photo. A file it *replaces* — `in_place`, or an `output`
that already exists — keeps the permission bits it had; a new `.clean` file gets
whatever your umask gives it, because a cleaned photo is usually on its way to
being shared.

## The desktop app

```bash
./run.sh
```

The window holds the same catalogue, the same forms (generated from each tool's
manifest), and the same reports as the command line — because it is the same
implementation, called directly. There is no server, no port, and no token: the
app talks to the engine through its own process, and nothing else can reach it.

**Finding a tool.** <kbd>Ctrl</kbd> <kbd>K</kbd> (or the field at the top) opens
the command palette: type a name, an id (`metadata-scan`), a tag, a capability
(`fs:read`), or an action (`settings`, `dark theme`, `recent runs`). Typos are
forgiving. Tools you use often stay under **Recent**, and anything you pin with
the pin button on a tool's header stays under **Pinned**. Each row also says when
that tool last ran, read from the audit trail.

**Two views.** The form is where a run starts; the report is where it ends. A
run moves the window to the report, and **Edit parameters** brings the form back
with the values you used. <kbd>Esc</kbd> does the same.

**Reading a report.** *Findings* groups what needs a decision by severity, narrows
by a severity chip, and offers the next tool where one applies (*Remove
metadata*, *Show disk usage*). The copy button beside the chips writes exactly
what is on screen as Markdown, ready for a ticket.
*Data* is the tool's structured result, sortable by column. *Changes* compares
the report with the previous run of the same tool — what appeared, what went, and
which verdicts moved — and appears once there is a previous run to compare with. *Raw* is the JSON, and every report can be copied as JSON,
downloaded, or repeated as a `gimlet-works run …` command. A metadata scan also draws a
**map of the file**: one bar per segment, in the order they sit in the bytes, so
"three segments found" becomes "these three, here".

**Checking the result.** A strip or encrypt report offers the tool that verifies
its own output — *Verify removal* or *Inspect the container* — with the file it
just wrote already filled in. A run that changes something should end with the check
that it changed the right thing.

**Settings and diagnostics** (the gear, or <kbd>Ctrl</kbd> <kbd>,</kbd>) names the
version, the engine, and where the state root, configuration file, and
audit trail live — with copy buttons and a way to open the data folder. The clock
button lists recent runs from the local audit trail; each row carries its verdict.

**Files.** Every `path` argument has a **Browse** button — a file picker or a
folder picker, whichever that argument's manifest implies — and a file dragged
onto the parameter card fills the first empty path. Drag and drop reads the path in
the preload, so the page never gains filesystem access.

**What the window remembers.** The theme (until you choose one, it follows the
system), the spacing (comfortable, or compact for shorter rows), the tool you were
using, the category, your pins and recents, the dry-run switch, and the window's
size and position. A window that would reopen off-screen is pulled back onto a
display that exists. **Settings → Use compact spacing**, or the palette's *Use
compact spacing*, toggles the density.

**Keyboard.** <kbd>?</kbd> lists every shortcut in the app; the same table is what
the hints in the window are generated from. The first <kbd>Tab</kbd> is *Skip to
the tool*, which lands you in the workbench instead of walking the chrome.

Every report carries the equivalent `gimlet-works run …` command, so a run in the
window can be repeated in a script.

## Scripting

Every report is JSON with the same shape, so one parser reads all of them:

```bash
gimlet-works system-info --format json | jq '.data.load.avg_1m'
gimlet-works batch crypto.sha256 ./files --input-arg path --concurrency 4 --format json
```

`batch` reports wall-clock duration (not the sum of per-file times) and counts
every outcome.

## Automation

Every report can be `--format json`, and failures honour it too: a script that
asks for JSON gets `{"error": {"code", "message"}}` on stderr rather than a
sentence meant for a person, and the exit status still says what happened — 0
for ok, 1 for a failed run, 2 for a command that was typed wrong.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `unsupported: … runs on linux, this is macos` | the tool declared `platforms`; it reads `/proc` or `df` |
| `no engine at …` | a tool that is not built in needed the optional engine; the standard install has every tool built in |
| `the engine speaks protocol N` | the optional engine came from a different build; rebuild it or unset `GIMLET_WORKS_SIDECAR` and `GIMLET_SIDECAR` |
| `unsupported: unrecognised container` | JPEG, PNG, and WebP are supported; another format is refused rather than guessed |
