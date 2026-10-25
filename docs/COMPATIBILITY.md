# Compatibility and evolution

Mellivora ToolKit is pre-1.0, but the parts other people build against — tool
ids, the report shape, the plugin protocol, and the config file — already have a
policy. This document states it.

## What is public API

| Surface | Stability | Notes |
|---|---|---|
| Tool ids (`sysadmin.system-info`) | Stable | Renames keep an alias for one minor release |
| `ToolManifest` fields | Stable | Additive changes only; new fields default on read |
| `Report` fields | Stable | `status` is derived from findings and must stay that way |
| Plugin protocol v1 | Versioned | A breaking change bumps `PROTOCOL_VERSION`; the host refuses mismatches |
| Config file | Versioned | `schema_version` is checked on load |
| `.melv` container | Versioned | Version byte in the header; v1 files must always open |
| HTTP API `/api/v1` | Versioned | Path carries the major version |
| Environment variables | Stable | `MELLIVORA_*`; new ones are additive |

Anything not in this table — internal module layout, parser helpers, the UI's
DOM — can change at any time.

## The shape of `Report.data`

`data` is public API, so it follows five rules. Without them a consumer has to
reverse-engineer each tool; with them, one parser handles every report.

1. **It is an object, or an array of objects that share their keys.** A tool with
   a single value reports `{ "value": … }`, not a bare scalar.
2. **Keys are `snake_case` and stable.** A rename follows the deprecation policy
   below — which is why `system-info` reports `load.avg_1m`, not `load.1m`.
3. **Nesting stops at two levels** — `data.a.b` and `data.a[].b`. Anything deeper
   is a second report, not data.
4. **A string carries a value, not a document.** No newlines, no ANSI escapes, no
   HTML. Prose belongs in `body`; a one-line verdict in `summary`.
5. **Units live in the key**: `_bytes`, `_kb`, `_ms`, `_percent`, `_hex`.

There is deliberately no per-tool schema at 1.0. One can be added additively
later; a schema *language* is a much larger promise than the shape itself.

The rules are enforced, not remembered: `crates/toolkit/tests/data_shape.rs` runs
every native tool against a sample invocation, checks rules 1–4, and fails when a
tool is added without a sample. Packs are expected to follow the same rules — the
host cannot check them today, which is what `plugins conformance` is for.

## Versioning

- **One workspace version.** Modules version together until something outside
  this repository consumes them.
- **Protocol and schema versions are separate** from the product version. A
  patch release never changes them; a change to them is a headline in the
  changelog.
- **Older config schemas load, newer ones are refused.** Fields a build does
  not know about take their defaults; a config written by a newer release fails
  with a clear message rather than being silently reinterpreted.
- **What 1.0 freezes, and what has to be true before it does,** is decided in
  [ADR 0006](adr/0006-what-1.0-promises.md). Until then this policy is a
  guideline; afterwards it is binding, with a one-minor deprecation rule.
- **The MSRV is a promise too.** The workspace declares `rust-version` in one
  place and CI compiles every target on exactly that version, `--locked`, so the
  number cannot drift away from what is actually tested. The current floor is
  1.85, set by the dependency graph (`zeroize`, `tokio`, `clap`, `hashbrown`),
  not by anything this project asks of the compiler. Raising it is a normal
  minor-release change; lowering it is not: once a release requires a version,
  older toolchains stay unsupported, because the lockfile keeps the crates that
  forced the raise. The desktop shell is a separate workspace and follows Tauri,
  which currently needs 1.90.

## Deprecating something

1. Mark it in the manifest summary: `(deprecated; use sysadmin.x)`.
2. Log a warning when it runs, naming the replacement.
3. Keep it for at least one minor release.
4. Remove it in a minor release, and say so in the changelog.

For tool ids, keep an alias that resolves the old name to the new tool for one
minor release first.

## Native implementations supersede packs

A capability can be served by a pack, then implemented natively. The transition
is deliberately quiet:

- Both expose the same `ToolManifest`, so no consumer changes.
- A built-in always wins an ambiguous shorthand, so the native tool takes over
  `system-info` the moment it exists.
- The pack tool stays reachable by its full id until it is removed a release
  later.

This is not a migration event; it is the normal lifecycle of a capability.

## Rollback

Each layer can be reverted independently because surfaces only talk to the
registry:

- **Disable a pack** with `plugins.disabled = ["name"]` — no code change.
- **Drop a native tool** from its module's `tools()` while the pack tool of the
  same id remains; the built-in-wins rule simply stops applying.
- **Swap a crypto engine** by constructing a different `CryptoBackend`.
- **Serve an older UI** independently of the engine; the API contract is
  versioned.

## Known compatibility risks

| Risk | Mitigation |
|---|---|
| A pack's stdout framing breaks after a runtime upgrade | Per-pack timeout and isolation; `plugins doctor` in CI; stray stdout lines are ignored |
| A native port changes a threshold or default | Port the tests first; move constants into config with defaults equal to the old behaviour |
| A crypto engine change alters a container format | Golden files gate the change; a format change requires an ADR |
| An external source checkout drifts | The pack reads it read-only and reports what it found; CI exercises it only when the upstream is reachable |
| A pack collides with a built-in id | Built-ins win resolution; collisions are logged and skipped at registration |

## Upgrading

```bash
mellivora doctor          # reports config, packs, and tool counts
mellivora config show     # effective settings after migration
mellivora tools list      # catalogue with origins (builtin vs plugin:*)
```

If `doctor` reports a config schema newer than the binary, upgrade the binary
rather than editing the file by hand.
