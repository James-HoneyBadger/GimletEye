# Contributing

## Setup

```bash
git clone https://github.com/James-HoneyBadger/Mellivora_ToolKit.git
cd Mellivora_ToolKit

rustup component add rustfmt clippy       # Rust 1.82+
./scripts/link-sources.sh                 # Perl Den, needed by the pack
(cd packages/ui && npm install)           # UI only
```

Verify:

```bash
make check                                # fmt check, clippy, tests
make ui                                   # UI type-check + build
make doctor                               # installation report, including packs
```

## Ground rules

1. **Respect the dependency direction.** `mellivora-core` must not depend on a
   domain crate. Modules must not depend on each other. Surfaces hold no logic.
2. **New capability? Add a tool, not a code path in a surface.** One line in
   `crates/cli/src/app.rs` (and the module's `tools()`).
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
// crates/cli/src/app.rs
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

CI also runs the UI build, the Perl pack syntax check, and a live end-to-end
slice that clones Perl Den and runs one module through the toolkit.

## Reporting problems

Security issues: privately, per [SECURITY.md](SECURITY.md). Everything else: a
GitHub issue including `mellivora doctor` output and the failing command.
