# 0004 — One config file with module-owned namespaces

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

- Perl Den has a YAML/JSON config with a versioned schema and per-script keys.
- DarkStar has its own config plus an encrypted keystore and contacts store.
- HB_Scrub reads `.hbscrubrc` from the project or home directory.

Three formats, three discovery rules, three answers to "where do I change the
disk threshold".

## Decision

One versioned TOML file at `$MELLIVORA_HOME/config.toml` (default
`~/.config/mellivora/config.toml`), with:

- core sections (`defaults`, `plugins`, `audit`), and
- a free-form `modules` table, keyed by module namespace:

```toml
[modules.sysadmin]
disk_warn_percent = 80

[modules.privacy]
profile = "sharing"
```

Modules read their own namespace via `ctx.config.module("sysadmin")`.

## Consequences

**Positive**

- Adding a module never edits `mellivora-core`, which keeps core dependency-free
  by construction.
- One discovery rule, one place for users to look, one file to back up.
- Schema version is checked on load; a newer schema is rejected rather than
  silently misread.

**Negative**

- Module settings are untyped at the core level: a typo in a module namespace is
  caught by the module, not by the loader.
- No cross-module validation (e.g. "two modules both want port 8080").

**Mitigations**

- Each module validates its own namespace on first use and reports
  `invalid_args`/`config` errors through the normal error path.
- Modules may publish a JSON Schema later; the config shape already accommodates
  one under `modules.<name>.$schema`.

## Rejected alternatives

- **Typed core fields per module:** couples core to every domain and requires a
  core change for each new module.
- **Per-module config files:** reintroduces the fragmentation this decision
  removes.
