# Contributing

## Setup

```bash
git clone https://github.com/James-HoneyBadger/Mellivora_ToolKit.git
cd Mellivora_ToolKit

rustup component add rustfmt clippy       # Rust 1.85+
./scripts/link-sources.sh                 # optional pack sources (warns if upstream is gone)
(cd packages/ui && npm install)           # UI only
```

Verify:

```bash
make check                                # fmt check, clippy, tests
make msrv                                 # builds on the declared rust-version
make quiet-period                         # frozen surfaces unchanged since the last tag
make ui                                   # UI type-check + build
make ui-test                              # UI unit and DOM tests (vitest)
make doctor                               # installation report, including packs
```

`rust-version` is tested, not aspirational: `scripts/check-msrv.sh` fails when
the manifest and the `msrv` CI job disagree, so raising the floor means changing
both, in the same commit.

Parsers are fuzzed. The soak harness needs nightly, so it is not part of
`make check`, but running it before touching JPEG/PNG/WebP/EXIF parsing is
expected:

```bash
rustup toolchain install nightly && cargo install cargo-fuzz
cd crates/scrub/fuzz && cargo +nightly fuzz run jpeg corpus/jpeg seeds/jpeg
```

`cargo test` already runs the same entry points deterministically over the
committed seeds and a mutation sweep, so a regression cannot pass CI unnoticed.
See [crates/scrub/fuzz/README.md](crates/scrub/fuzz/README.md).

## Ground rules

1. **Respect the dependency direction.** `mellivora-core` must not depend on a
   domain crate. Modules must not depend on each other. Surfaces hold no logic.
2. **New capability? Add a tool, not a code path in a surface.** One line in
   `crates/toolkit/src/runtime.rs` (and the module's `tools()`).
3. **Findings, not prints.** A problem is `report.add_finding(severity, code,
   message)`. `status` is derived by `sealed()`.
4. **Honour `--dry-run`** in anything that writes, and say so in the report.
5. **Parsers stay pure.** Filesystem and process access belongs in the tool, not
   the parser, so tests need no fixtures on disk.
6. **Never log secrets.** Audit records argument names only.
7. **No new dependency without a reason** in the pull request. Crypto
   dependencies need an ADR.

## Adding a module

```rust
// crates/newthing/src/lib.rs
pub fn tools() -> mellivora_core::Result<Vec<std::sync::Arc<dyn Tool>>> {
    Ok(vec![std::sync::Arc::new(MyTool::new())])
}
```

```toml
# Cargo.toml — workspace members + [workspace.dependencies]
```

```rust
// crates/toolkit/src/runtime.rs
registry.register_all(mellivora_newthing::tools()?)?;
```

Then add a test that runs the tool with a `ToolContext` pointing at a temp
`AppPaths`, and one that asserts the finding/status relationship.

## Adding a pack

See [docs/PLUGIN_SDK.md](docs/PLUGIN_SDK.md) and copy
`plugins/perlden-pack/` as a starting point. Packs are the right choice for
existing code in another language; modules are the right choice for new,
performance-sensitive, or security-critical code.

## Commit and pull request style

- Imperative subject, ≤ 72 characters: `Add disk-usage threshold config`.
- Explain *why* in the body; the diff explains *what*.
- Reference the tool id or module affected.
- Include tests for behaviour changes; include the output of `make check`.
- One logical change per pull request.

## Tests

```bash
cargo test --workspace                      # everything
cargo test -p mellivora-scrub               # one crate
cargo test -p mellivora-core report::       # one area
```

CI also runs the UI build, the UI test suite, the Perl pack syntax check, and a
live end-to-end slice. That slice runs a pack module when the optional upstream
sources are reachable and skips the pack when they are not; `REQUIRE_SOURCES=1`
makes `scripts/link-sources.sh` fail instead.

## Reporting problems

Security issues: privately, per [SECURITY.md](SECURITY.md). Everything else: a
GitHub issue including `mellivora doctor` output and the failing command.
