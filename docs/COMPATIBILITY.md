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
| `.gimlet` container | Versioned | Version byte in the header; v1, v2, and v3 files must always open, and an independent reader in `crates/crypto/tests/interop/` proves [CONTAINER.md](CONTAINER.md) is enough to implement it |
| Keystore (`keystore.gimlet`) | Versioned | `schema_version` in the sealed document; a newer schema is refused, not guessed |
| Environment variables | Stable | `GIMLET_*`; new ones are additive |
| `Report.data` keys | Stable | Renames keep the old key for one minor (see the `algorithm`/`kind` example below) |

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
| `gimlet help` | The help text | — |
| `gimlet version` | The version | — |

Global flags, accepted before or after the command:

| Flag | Meaning |
|---|---|
| `--home <DIR>` | Toolkit home (config, audit, keystore) |
| `--format <text\|json\|markdown\|csv\|html>` | Report format |
| `--json` | Shorthand for `--format json` |
| `--dry-run` | Report intended changes without writing them |
| `--strict` | Exit non-zero on a warning verdict |
| `-v`, `--verbose` | More logging on stderr, repeatable |
| `-h`, `--help` | The help text |
| `-V`, `--version` | The version |

Exit codes: `0` for an ok or warning run, `1` for an error verdict or a failed
run, `2` for a command typed wrong.

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
