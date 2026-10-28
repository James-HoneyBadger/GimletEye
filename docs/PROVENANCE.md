# Provenance

Gimlet Eye is an independent project: its contracts, module layout, surfaces,
and infrastructure are defined here, for this toolkit.

Some capabilities began by reimplementing behaviour that already existed in
earlier tools by the same author. This file records that lineage so maintainers
can answer "where did this come from?" without that history defining the
project's identity or architecture.

## Module lineage

| Module / capability | Began as | Status |
|---|---|---|
| `sysadmin.system-info` | host-inventory script from an earlier Perl sysadmin toolkit | Reimplemented natively; behaviour and outputs covered by this repository's tests |
| `sysadmin.disk-usage` | filesystem-utilisation script from the same toolkit | Reimplemented natively, with thresholds moved into config |
| `crypto.*` primitives | `node:crypto` (OpenSSL) and `@noble/hashes` | Engine and `.gimlet` container implemented here |
| `privacy.metadata-*` | a TypeScript metadata-scrubbing library by the same author | JPEG/PNG/WebP reimplemented natively; profiles and GPS redaction designed here |

## Compatibility packs

`plugins/perlden-pack`, an optional adapter that ran modules from an external
Perl toolkit over a plugin protocol, is gone: both were removed at 0.8
([COMPATIBILITY.md](COMPATIBILITY.md)). Nothing in this tree depends on either.

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
