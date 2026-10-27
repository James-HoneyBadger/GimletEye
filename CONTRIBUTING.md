# Contributing

Thank you for considering a change. This project values small, verifiable
increments over large ones: a fix with a test that fails without it is worth more
than three without.

## Set up

```bash
git clone https://github.com/James-HoneyBadger/GimletEye
cd GimletEye

cargo build --release -p gimlet-eye-sidecar   # the engine
npm install                                   # CLI + desktop + tests
npm run build                                 # packages/core and packages/cli
./packages/cli/bin/gimlet doctor
```

`./run.sh --cli system-info` builds whatever is out of date first, if you would
rather not think about the order.

Requirements: Rust 1.85+ and Node 20+. `gpg` is only needed for the OpenPGP
interop tools.

## Before you push

```bash
make check        # cargo fmt --check, clippy -D warnings, tsc, cargo test, vitest
make smoke        # the CLI against the real engine
```

`make check` is what CI runs. A pull request that fails it will not be reviewed
until it passes, because a green baseline is what makes review cheap.

## Where a change goes

| You are changing | Put it in |
|---|---|
| What a run means: verdicts, reports, resolution, config, audit | `packages/core` |
| A command, a flag, or terminal output | `packages/cli` |
| The window, forms, and result rendering | `apps/desktop/src` |
| A host-inspection tool (`/proc`, `df`) | `packages/core/src/tools` |
| Anything touching key material or a file format | `crates/crypto`, `crates/scrub` |
| The window or the OS boundary | `apps/desktop/src-tauri` |

Two rules decide most placement questions:

1. **The surfaces hold no logic.** If both the CLI and the window need it, it
   belongs in `packages/core`.
2. **Risk follows the evidence.** Crypto and format parsing stay in Rust because
   that is where the fuzz corpora, the fixtures, and the second implementation
   live. Moving them to TypeScript means rebuilding that evidence, not just
   translating the code.

## Adding a tool

A host-inspection tool is a `LocalTool` in `packages/core/src/tools`, registered
in `Runtime.load`. An engine tool is a `Tool` in `crates/crypto` or
`crates/scrub`, added to that crate's `tools()`; both surfaces pick it up from
the catalogue at start, so there is no frontend change either way.
[ARCHITECTURE.md](docs/ARCHITECTURE.md) §8 has the details.

Either way: give the manifest a summary worth reading, and add a test at the
level where the behaviour lives.

## Style

- Rust: `cargo fmt`, no `unsafe` (the workspace forbids it), and clippy warnings
  are errors.
- TypeScript: `strict`, and no new runtime dependency without a reason in the
  pull request — the CLI has exactly one.
- Comments explain *why*. A comment that restates the line is noise.
- Public behaviour gets a line in `CHANGELOG.md` under the release it ships in.

## Merging to `main`

`main` is protected: no force pushes, no deletion, and a pull request cannot be
merged until `ci` is green. Two consequences worth knowing before a branch goes
up.

**Job names are part of the contract.** The required checks are the job names in
`.github/workflows/ci.yml`, so renaming one silently un-requires it and leaves a
merge gate that no longer gates anything. If a job has to be renamed, do it in
the same change that updates the ruleset. The current set:

| Required check | What it proves |
|---|---|
| `rust (fmt, clippy, test)` | formatting, lints, and the engine's tests |
| `msrv (declared rust-version)` | the promised minimum still compiles |
| `quiet period (frozen surfaces)` | no versioned surface moved (see below) |
| `typescript (typecheck, test, build)` | the shared core, the CLI, and the UI |
| `integration (CLI against the engine)` | the two halves agree, end to end |
| `docs (claims, surface, reference)` | the docs still describe this build |
| `desktop (typecheck, UI bundle, shell check)` | the window builds |
| `packaging (version agreement, staged layout)` | a package runs after install |

**The quiet-period check can be legitimately red.** It fails whenever a versioned
surface changed since the last release, which is the case for every commit between
a deliberate break and the release that ships it. `ALLOW_SURFACE_CHANGE` in the
workflow accepts the break and restarts the countdown; that is recorded in
`CHANGELOG.md` and ADR 0006. Do not weaken the check to make a merge gate go
green — set the variable and say why.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md) for the private
channel and what is in scope.
