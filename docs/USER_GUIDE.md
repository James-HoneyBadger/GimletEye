# User guide

Every command, with the output it actually produces. Run `mellivora --help` for
the same list without the commentary.

- [First run](#first-run)
- [Tools](#tools)
- [Encryption](#encryption)
- [Keys](#keys)
- [Signatures](#signatures)
- [Metadata](#metadata)
- [The workbench](#the-workbench)
- [Scripting](#scripting)
- [Troubleshooting](#troubleshooting)

## First run

```bash
mellivora doctor
```

`doctor` prints where state lives, what was found, and where the audit trail is:

```text
mellivora 0.7.0
home        /home/you/.config/mellivora
config      /home/you/.config/mellivora/config.toml (defaults)
state dirs  ok
tools       39 total
  crypto       14
  privacy      3
  sysadmin     22
packs       1 loaded
  perlden          20 tool(s)
audit       /home/you/.config/mellivora/audit.jsonl
```

There is no configuration to write before the first command: defaults are used
until you create one with `mellivora config init`.

## Tools

```bash
mellivora tools list                 # the catalogue, with origins and platforms
mellivora tools list --category crypto
mellivora tools show crypto.encrypt  # one manifest as JSON
```

Every tool is invoked the same way — `mellivora <tool> key=value …` — and every
tool takes the same global flags:

| Flag | Effect |
|---|---|
| `--format text\|json\|markdown` | output shape; `--json` is shorthand |
| `--dry-run` | do everything except the write |
| `-v` | debug logging to stderr |

`mellivora run <tool> …` is the explicit spelling; the shorthand form
(`mellivora system-info`) is an alias that resolves suffixes, so `sha256` finds
`crypto.sha256`.

## Encryption

Passphrase encryption, streaming, bounded memory:

```bash
export NOTES_PASS='correct horse battery staple'
mellivora crypto.encrypt input=notes.txt passphrase_env=NOTES_PASS
mellivora crypto.inspect input=notes.txt.melv
mellivora crypto.decrypt input=notes.txt.melv output=notes.clear.txt passphrase_env=NOTES_PASS
```

`passphrase_env` is preferred over `passphrase=` because an inline value lands in
shell history and in the process list. A wrong passphrase fails closed with
`decryption failed: wrong passphrase or corrupted file`; the two cases are
deliberately indistinguishable, and the file is never partially written.

Encrypting to a person instead of a secret:

```bash
mellivora crypto.encrypt input=notes.txt to=alice.pub        # version 3 container
mellivora crypto.decrypt input=notes.txt.melv key=alice.key   # alice's secret half
```

## Keys

Keys live in one sealed file, `$MELLIVORA_HOME/keystore.melv`, opened with a
passphrase:

```bash
mellivora crypto.keygen kind=x25519 label=alice keystore=true passphrase_env=KEY_PASS
mellivora crypto.key-list passphrase_env=KEY_PASS
mellivora crypto.key-export selector=alice output=alice.pub passphrase_env=KEY_PASS
mellivora crypto.key-export selector=alice output=alice.key secret=true passphrase_env=KEY_PASS
mellivora crypto.key-import key=bob.pub label=bob public_only=true passphrase_env=KEY_PASS
mellivora crypto.key-rotate passphrase_env=KEY_PASS new_passphrase_env=KEY_PASS_2
```

`kind=ed25519` makes a signing key; `kind=x25519` makes a recipient key. Without
`keystore=true` the key is written as two files (`.key` and `.pub`), which is
what you want for a key you hand to someone.

Rotation re-seals the store — it does not regenerate keys, because that would
invalidate every signature already published.

## Signatures

```bash
mellivora crypto.keygen label=signer dir=~/keys
mellivora crypto.sign input=contract.txt key=~/keys/signer.key
mellivora crypto.verify input=contract.txt signature=contract.txt.sig key=~/keys/signer.pub
```

`sign` refuses to write over its input and refuses to replace an existing
signature without `overwrite=true`.

OpenPGP interop uses the system `gpg`:

```bash
mellivora crypto.gpg-verify input=release.tar signature=release.tar.asc
mellivora crypto.gpg-encrypt input=secret.txt recipient=alice@example.com
```

## Metadata

```bash
mellivora privacy.metadata-scan   input=photo.jpg
mellivora privacy.metadata-strip  input=photo.jpg profile=sharing
mellivora privacy.metadata-verify input=photo.clean.jpg
```

Profiles: `privacy` removes identity, text, and time; `sharing` keeps time;
`archive` removes nothing (pair it with `redact_gps=city`). `strip` writes a
`.clean` copy by default, keeps the original's permissions, and writes through a
temporary file so an interrupted run cannot truncate a photo.

## The workbench

```bash
mellivora serve --ui-dir packages/ui/dist
```

It prints a URL that carries its own token in the fragment:

```text
Mellivora ToolKit 0.7.0 → http://127.0.0.1:7878
  API   http://127.0.0.1:7878/api/v1/health
  token … (stored in /home/you/.config/mellivora/api-token, mode 0600)
```

The token is required on every `/api/` request. The browser reads it from the
fragment and strips it from the address bar; the desktop window has it injected.
`[api] require_token = false` disables it and says so at startup.

## Scripting

Every report is JSON with the same shape, so one parser reads all of them:

```bash
mellivora system-info --format json | jq '.data.load.avg_1m'
mellivora batch crypto.sha256 ./files --input-arg path --concurrency 4 --format json
```

`batch` reports wall-clock duration (not the sum of per-file times) and counts
every outcome.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `unsupported: … runs on linux, this is macos` | the tool declared `platforms`; it reads `/proc` or `df` |
| `capability denied: process:exec` | the pack needs a capability `[plugins] allow` does not grant |
| `401` from the API | the request has no `Authorization: Bearer …` header |
| `unsupported: unrecognised container` | JPEG, PNG, and WebP are native; others need a pack |
