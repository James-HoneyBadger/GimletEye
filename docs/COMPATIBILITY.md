# Compatibility and evolution

Gimlet Eye is pre-1.0, but the parts other people build against — tool ids, the
report shape, the plugin-free engine protocol, and the config file — already have
a policy. This document states it.

## Surfaces

Two programs ship: the `gimlet` command line and the desktop app. They share one
implementation (`packages/core`), so anything below that names a tool id, a report
field, or a configuration key applies to both.

The engine package (`packages/engine`) is **not** an extension point. Both
surfaces import it, and it contains only the tools this build compiled. It is
listed here because its behaviour — the bytes it writes, the reports it returns —
is part of the contract, not because it accepts third-party code.

## What is public API

| Surface | Stability | Notes |
|---|---|---|
| Tool ids (`sysadmin.system-info`) | Stable | Renames keep an alias for one minor release |
| `ToolManifest` fields | Stable | Additive changes only; new fields default on read |
| `Report` fields | Stable | `status` is derived from findings and must stay that way |
| Engine protocol v1 | Versioned | A breaking change bumps `protocol_version`; a surface refuses a mismatch |
| Config file | Versioned | `schema_version` is checked on load |
| `.gimlet` container | Versioned | Version byte in the header; v1, v2, and v3 files must always open, and an independent reader in `packages/engine/test/fixtures/read_container.py` proves [CONTAINER.md](CONTAINER.md) is enough to implement it |
| Keystore (`keystore.gimlet`) | Versioned | `schema_version` in the sealed document; a newer schema is refused, not guessed |
| Environment variables | Stable | `GIMLET_*`; new ones are additive |
| `Report.data` shape | Stable | Declared per tool in `ToolManifest.data` (`shape`, `required`, `optional`), checked by the runtime before a surface sees the report, and compared with real reports by `scripts/check-data-schema.sh`. A union like `number\|null` is written where a dry run returns null |
| `Report.data` keys | Stable | Renames keep the old key for one minor (see the `algorithm`/`kind` example below) |
| Failure output | Stable | With `--format json`, a failure writes `{"error": {"code", "message"}}` to stderr; other formats write one `gimlet: …` line. Exit status is 0 for ok, 1 for a failed run, 2 for a command the user typed wrong |

Anything not in this table — internal module layout, parser helpers, the UI's
DOM — can change at any time.

### Removed at 0.8

The following belonged to surfaces that no longer exist. They are listed so a
script that used them fails with an explanation rather than a mystery:

| Removed | Was |
|---|---|
| `gimlet serve` and `/api/v1/*` | A local HTTP API and a browser build |
| `api-token`, `[api] require_token` | Authentication for that API |
| `gimlet plugins …`, `mellivora-pack.toml`, pack digests | The JSON-RPC pack protocol |
| `ToolManifest.origin`, `.version` | Pack provenance |
| `[plugins]` and `[trust]` in `config.toml` | Pack discovery and pinning |

A config file that still contains those sections loads: the sections are ignored
rather than rejected.

### The CLI surface

The commands and flags below are public API: they are what scripts and packaging
recipes invoke, so a rename is a breaking change and follows the deprecation
policy just like a field rename.

| Command | Purpose | Flags it adds |
|---|---|---|
| `gimlet <tool-id> [KEY=VALUE…]` | Shorthand for `run` | — |
| `gimlet run <tool> [KEY=VALUE…]` | Run one tool | — |
| `gimlet batch <tool> <PATH…>` | Run a tool over many files, one report per file plus an aggregate | `--arg`, `--input-arg`, `--concurrency`, `-c`, `--fail-fast`, `--ext`, `--no-recursive` |
| `gimlet tools list` | The catalogue as a table | `--category` |
| `gimlet tools show <id>` | One manifest as JSON | — |
| `gimlet config show` | The effective configuration | — |
| `gimlet config init` | Write a default config file | `--force` |
| `gimlet config path` | Where the config file is looked for | — |
| `gimlet audit` | Recent audit records | `--limit` |
| `gimlet doctor` | Check the installation | — |
| `gimlet tui` | Browse and run tools in the terminal | — |
| `gimlet completions <shell>` | A completion script for bash, zsh, or fish | — |
| `gimlet man` | The man page, in roff | — |
| `gimlet help` | The help text | — |
| `gimlet version` | The version | — |

Global flags, accepted before or after the command:

| Flag | Meaning |
|---|---|
| `--home <DIR>` | Toolkit home (config, audit, keystore) |
| `--format <text\|json\|markdown\|csv\|html>` | Report format |
| `--json` | Shorthand for `--format json` |
| `--output <FILE>` | Write the report to a file instead of stdout |
| `-q`, `--quiet` | Nothing on stdout; the exit status carries the verdict |
| `--dry-run` | Report intended changes without writing them |
| `--strict` | Exit non-zero on a warning verdict |
| `-v`, `--verbose` | More logging on stderr, repeatable |
| `-h`, `--help` | The help text |
| `-V`, `--version` | The version |

Exit codes: `0` for an ok or warning run, `1` for an error verdict or a failed
run, `2` for a command typed wrong — an unknown tool id, an unknown flag, or an
invalid argument.

### Tool arguments

A tool's arguments are the `KEY=VALUE` pairs a surface supplies: `k=v` on the
command line, a field in the desktop form, `--arg` in `batch`, or a JSON object
over the engine protocol. They are validated against the tool's manifest before
anything runs.

- Only text that survives a round trip is coerced: `true`/`false` and canonical
  integers become typed values. `0123`, `+5`, and `-0` stay strings, because
  rewriting them would change a passphrase, a PIN, or a file name.
- A name the manifest does not declare is `invalid_args`. A missing required
  value, an enum value outside its list, a negative or unrepresentable integer,
  and a boolean that is not `true`/`false`/`yes`/`no`/`1`/`0` are the same
  error. Exit status is `2`, and the message names every problem at once.
- Duplicate names on the command line keep the last value, as a shell would.
- A built-in tool that performs a write or starts a subprocess it did not declare
  in its manifest fails with `capability_denied` (exit 1). This is a bug in the
  tool, not in the caller's arguments.
- A tool that takes a passphrase masks it in the desktop, hides the argument
  line in the terminal, and shows `passphrase=<redacted>` in a copied command.

### Environment variables

| Variable | Meaning |
|---|---|
| `GIMLET_HOME` | The state root; defaults to `~/.config/gimlet` |
| `GIMLET_SIDECAR` | Optional path to a separate engine, for comparing two implementations; the built-in tools do not need it |

## The report contract

Every tool returns the same shape, whatever language implemented it:

```json
{
  "tool": "crypto.encrypt",
  "status": "ok",
  "summary": "encrypted notes.txt → notes.txt.gimlet",
  "findings": [],
  "data": {},
  "body": null,
  "warnings": [],
  "duration_ms": 313
}
```

`status` is never set by a tool directly: it is derived from the findings
(`high` or worse ⇒ `error`, `medium` ⇒ `warning`, otherwise `ok`), so a tool that
reports a serious problem cannot also report success.

### Renaming a key, without breaking a reader

When a `data` key is renamed, the old key stays for one minor release with the
same value. `algorithm` → `kind` did this in 0.4; the deprecation is listed in
the changelog for the release that removes it.

## The engine protocol

One JSON object per line in, one per line out. A surface sends:

```json
{"id": 1, "op": "handshake"}
{"id": 2, "op": "list"}
{"id": 3, "op": "run", "tool": "crypto.sha256", "args": {"text": "hello"}, "dry_run": false, "home": "/home/you/.config/gimlet"}
```

and the engine answers with the same `id`:

```json
{"id": 1, "ok": true, "protocol_version": 1, "version": "0.7.0"}
{"id": 2, "ok": true, "tools": [ … ]}
{"id": 3, "ok": true, "report": { … }}
{"id": 4, "ok": false, "error": {"code": "invalid_args", "message": "…"}}
```

`protocol_version` is checked on connect: a surface built against a different
version refuses the engine instead of guessing. `code` is stable and is what the
CLI maps to an exit status.

## Deprecation policy

- A rename or removal ships with a changelog entry naming the old spelling.
- One minor release keeps the old spelling working where that is possible
  (`Report.data` keys, tool-id aliases). Where it is not possible — an exit code,
  a removed command — the removal is listed under "Removed".
- The quiet-period gate (`scripts/check-quiet-period.sh`) fails when a frozen
  surface moves without `ALLOW_SURFACE_CHANGE`, so a rename cannot slip into a
  release unnoticed.
