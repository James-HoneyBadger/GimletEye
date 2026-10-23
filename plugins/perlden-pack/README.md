# Perl Den pack

Serves the 20 Perl Den sysadmin modules to Mellivora ToolKit over the plugin
protocol, with **no rewrite**. The pack loads each module's existing
`run(%args)` / `format_report(%result)` pair and translates the result into a
toolkit `Report`.

## Requirements

- `perl` 5.28+
- `JSON::PP` (core)
- A Perl Den checkout

## Finding the source

The pack resolves a Perl Den root in this order:

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

## Why this shape

Perl Den's value is its 20 tested sysadmin checks and its module contract.
Rewriting them in Rust first would have delayed the unified toolkit and thrown
away the tests. Instead the pack is an adapter: the modules are reused as-is,
and each one can be ported to a native `mellivora-sysadmin` module later with
no change to the CLI, API, or UI.
