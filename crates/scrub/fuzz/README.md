# Fuzz targets

Four libFuzzer targets over the parsers that delete bytes. They need nightly and
libFuzzer, so the crate is detached from the workspace and runs on a schedule
([`fuzz.yml`](../../../.github/workflows/fuzz.yml)); the same entry points also
run deterministically in `crates/scrub/tests/parsers_never_panic.rs` on every
`cargo test`.

## Run one

```bash
rustup toolchain install nightly
cargo install cargo-fuzz
cd crates/scrub/fuzz
cargo +nightly fuzz run jpeg corpus/jpeg seeds/jpeg -- -max_total_time=600
```

`seeds/` is committed — a handful of small, well-formed files per format, plus
one per interesting edge. `corpus/` is the working directory libFuzzer grows
freely and is gitignored; pass both so the run starts from the seeds and keeps
what it learns.

Reproduce a crash by passing the artifact:

```bash
cargo +nightly fuzz run jpeg artifacts/jpeg/crash-<hash>
```

| Target | Entry point |
|---|---|
| `jpeg` | scan → strip → re-scan |
| `png` | scan → strip → re-scan |
| `webp` | no-op strip (archive profile), strip, re-scan |
| `exif` | `exif_ranges` + `redact_gps_payload`, twice over (idempotence) |

## What counts as a failure

The invariant is the one `privacy.metadata-strip` promises: **a strip that
succeeds leaves nothing for the policy to remove**, and what it produced is a
container this build can still read. Refusing malformed input is a pass, not a
crash — `MetadataStrip::run` fails closed on it by re-scanning before it writes.

A panic, an unbounded allocation, or a strip that leaves removable bytes behind
is a bug worth an issue: include the artifact and the target name.
