# Perl Den compatibility pack

**Optional.** Mellivora ToolKit does not require this pack; the CLI, HTTP API,
and UI work without it. Install it only if you want Perl Den's sysadmin module
catalogue available alongside the native tools.

The pack runs each Perl Den module over the Mellivora plugin protocol and
translates its `run(%args)` / `format_report(%result)` pair into a toolkit
`Report`. The modules are read from a checkout; nothing is vendored here.

## Requirements

- `perl` 5.28+
- `JSON::PP` (core)
- A Perl Den checkout

## Finding the source

The pack resolves a root in this order:

1. `MELLIVORA_PERLDEN_HOME`
2. `../../external/Perl_Den` relative to this directory
3. `~/Perl_Den`, `~/PerlDen`, `~/src/Perl_Den`

`scripts/link-sources.sh` populates `external/` for you.

## Tools exposed

Every `lib/PerlDen/Scripts/*.pm` becomes `perlden.<kebab-case-name>`, for
example `perlden.system-info`, `perlden.port-scanner`,
`perlden.failed-login-detector`.

```bash
mellivora plugins doctor
mellivora run perlden.system-info
mellivora run perlden.disk-usage --format json
```

## Interaction with native tools

A built-in tool always wins an ambiguous shorthand. Once `sysadmin.system-info`
exists natively, `mellivora system-info` runs the native tool; the pack's
version stays reachable as `perlden.system-info` until it is retired. See
[COMPATIBILITY.md](../../docs/COMPATIBILITY.md).

## Why a pack rather than a port

The modules are tested and in use. Wrapping them costs an afternoon and keeps
the checks available while native implementations land one at a time. When a
module is ported, the pack tool simply stops being the default and is removed a
release later — no user-facing change.
