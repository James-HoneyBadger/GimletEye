# User guide

Every command, with the output it actually produces. Run `gimlet --help` for
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
gimlet doctor
```

`doctor` prints where state lives, what was found, and where the audit trail is:

```text
gimlet 0.7.0
home        /home/you/.config/gimlet
config      /home/you/.config/gimlet/config.toml (defaults)
state dirs  ok
tools       19 total
  crypto       14
  privacy      3
  sysadmin     2
engine      v0.7.0
audit       /home/you/.config/gimlet/audit.jsonl
```

There is no configuration to write before the first command: defaults are used
until you create one with `gimlet config init`.

## Tools

```bash
gimlet tools list                 # the catalogue, with origins and platforms
gimlet tools list --category crypto
gimlet tools show crypto.encrypt  # one manifest as JSON
```

Every tool is invoked the same way — `gimlet <tool> key=value …` — and every
tool takes the same global flags:

| Flag | Effect |
|---|---|
| `--format text\|json\|markdown\|csv\|html` | output shape; `--json` is shorthand |
| `--dry-run` | do everything except the write |
| `-v` | debug logging to stderr |

`html` writes one self-contained page — no script, no stylesheet, no request —
so a report can be filed or handed to someone who has no copy of the toolkit:

```bash
gimlet sysadmin.disk-usage --format html > disk.html
```

## The terminal surface

`gimlet tui` is the same catalogue, the same tools, and the same report contract
as the CLI and the desktop app, drawn in the terminal:

```bash
gimlet tui
```

Type to filter (`crypto key` narrows by every word), `↑`/`↓` to move, `enter` to
run the selected tool — argument-taking tools prompt for `key=value` pairs — and
`esc` to clear the filter or step back. Results scroll with `↑`/`↓` and page
with `pgup`/`pgdn`; `ctrl-c` quits. Runs started here are recorded in the audit
trail like any other, because the TUI calls the same `Runtime.run`.

`gimlet run <tool> …` is the explicit spelling; the shorthand form
(`gimlet system-info`) is an alias that resolves suffixes, so `sha256` finds
`crypto.sha256`.

## Encryption

Passphrase encryption, streaming, bounded memory:

```bash
export NOTES_PASS='correct horse battery staple'
gimlet crypto.encrypt input=notes.txt passphrase_env=NOTES_PASS
gimlet crypto.inspect input=notes.txt.gimlet
gimlet crypto.decrypt input=notes.txt.gimlet output=notes.clear.txt passphrase_env=NOTES_PASS
```

`passphrase_env` is preferred over `passphrase=` because an inline value lands in
shell history and in the process list. A wrong passphrase fails closed with
`decryption failed: wrong passphrase or corrupted file`; the two cases are
deliberately indistinguishable, and the file is never partially written.

Encrypting to a person instead of a secret:

```bash
gimlet crypto.encrypt input=notes.txt to=alice.pub        # version 3 container
gimlet crypto.decrypt input=notes.txt.gimlet key=alice.key   # alice's secret half
```

## Keys

Keys live in one sealed file, `$GIMLET_HOME/keystore.gimlet`, opened with a
passphrase:

```bash
gimlet crypto.keygen kind=x25519 label=alice keystore=true passphrase_env=KEY_PASS
gimlet crypto.key-list passphrase_env=KEY_PASS
gimlet crypto.key-export selector=alice output=alice.pub passphrase_env=KEY_PASS
gimlet crypto.key-export selector=alice output=alice.key secret=true passphrase_env=KEY_PASS
gimlet crypto.key-import key=bob.pub label=bob public_only=true passphrase_env=KEY_PASS
gimlet crypto.key-rotate passphrase_env=KEY_PASS new_passphrase_env=KEY_PASS_2
```

`kind=ed25519` makes a signing key; `kind=x25519` makes a recipient key. Without
`keystore=true` the key is written as two files (`.key` and `.pub`), which is
what you want for a key you hand to someone.

Rotation re-seals the store — it does not regenerate keys, because that would
invalidate every signature already published.

## Signatures

```bash
gimlet crypto.keygen label=signer dir=~/keys
gimlet crypto.sign input=contract.txt key=~/keys/signer.key
gimlet crypto.verify input=contract.txt signature=contract.txt.sig key=~/keys/signer.pub
```

`sign` refuses to write over its input and refuses to replace an existing
signature without `overwrite=true`.

OpenPGP interop uses the system `gpg`:

```bash
gimlet crypto.gpg-verify input=release.tar signature=release.tar.asc
gimlet crypto.gpg-encrypt input=secret.txt recipient=alice@example.com
```

## Metadata

```bash
gimlet privacy.metadata-scan   input=photo.jpg
gimlet privacy.metadata-strip  input=photo.jpg profile=sharing
gimlet privacy.metadata-verify input=photo.clean.jpg
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

Every report carries the equivalent `gimlet run …` command, so a run in the
window can be repeated in a script. The clock button lists recent runs from the
local audit trail.

## Scripting

Every report is JSON with the same shape, so one parser reads all of them:

```bash
gimlet system-info --format json | jq '.data.load.avg_1m'
gimlet batch crypto.sha256 ./files --input-arg path --concurrency 4 --format json
```

`batch` reports wall-clock duration (not the sum of per-file times) and counts
every outcome.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `unsupported: … runs on linux, this is macos` | the tool declared `platforms`; it reads `/proc` or `df` |
| `no engine at …` | a tool that is not built in needed the optional engine; the standard install has every tool built in |
| `the engine speaks protocol N` | the optional engine you pointed at came from a different build; rebuild it or unset `GIMLET_SIDECAR` |
| `unsupported: unrecognised container` | JPEG, PNG, and WebP are supported; another format is refused rather than guessed |
