# Provenance

Mellivora ToolKit is an independent project: its contracts, module layout,
plugin protocol, surfaces, and infrastructure are defined here, for this
toolkit.

Some capabilities began by reimplementing behaviour that already existed in
earlier tools by the same author. This file records that lineage so maintainers
can answer "where did this come from?" without that history defining the
project's identity or architecture.

## Module lineage

| Module / capability | Began as | Status |
|---|---|---|
| `sysadmin.system-info` | host-inventory script from an earlier Perl sysadmin toolkit | Reimplemented natively; behaviour and outputs covered by this repository's tests |
| `sysadmin.disk-usage` | filesystem-utilisation script from the same toolkit | Reimplemented natively, with thresholds moved into config |
| `crypto.*` primitives | a Rust cryptography suite by the same author | Seam defined here (`CryptoBackend`); engine adoption pending |
| `privacy.metadata-*` | a TypeScript metadata-scrubbing library by the same author | JPEG/PNG/WebP reimplemented natively; profiles and GPS redaction designed here |

## Compatibility packs

`plugins/perlden-pack` is an **optional adapter**: it runs modules from an
external Perl toolkit over the plugin protocol so those checks remain available
while native ports land. It is not part of the core architecture, it is not
required by the CLI, HTTP API, or UI, and installing it never overrides a
built-in tool.

The pack reads its source checkout read-only and is not vendored here.

## Licensing

All upstream projects and this one are MIT-licensed, by the same author, so the
lineage is recorded for accuracy rather than to satisfy an obligation. When a
capability is reimplemented, the implementation and its tests live here and are
maintained here.

## Why this file is short

Provenance is a maintainer note, not a product statement. The toolkit's
documentation, CLI help, tool manifests, and reports describe behaviour directly
— what a tool does, what it reads, what it writes — so users never need to know
which earlier codebase a module evolved from.
