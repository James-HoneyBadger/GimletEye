# Contributing

Thank you for considering a change. This project values small, verifiable
increments over large ones: a fix with a test that fails without it is worth more
than three without.

## Set up

```bash
git clone https://github.com/James-HoneyBadger/GimletEye
cd GimletEye

npm install                                   # CLI + desktop + tests
npm run build                                 # every package and the CLI
./packages/cli/bin/gimlet doctor
```

`./run.sh --cli system-info` builds whatever is out of date first, if you would
rather not think about the order.

Requirements: Node 20+. `gpg` is only needed for the OpenPGP interop tools.

## Before you push

```bash
make check        # tsc, vitest, and the documentation gates
make smoke        # the CLI against real files
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
| The window or the OS boundary | `apps/desktop/electron` |

Two rules decide most placement questions:

1. **The surfaces hold no logic.** If both the CLI and the window need it, it
   belongs in `packages/core`.
2. **Risk follows the evidence.** Crypto and format parsing live in
   `packages/engine`, next to the fixtures, the corpus, and the Python second
   implementation that pin them. A change there has to keep those passing; the
   evidence is the point, not the language.

## Adding a tool

A tool is a `LocalTool` in `packages/core/src/tools`, and it must be added to
`NODE_TOOLS` in `packages/core/src/node.ts` — a tool that is written but not
listed keeps resolving to whatever else serves that id, which
`node-tools.test.ts` exists to catch. Both surfaces pick it up from the
catalogue at start, so there is no frontend change either way.
[ARCHITECTURE.md](docs/ARCHITECTURE.md) §8 has the details.

Either way: give the manifest a summary worth reading, and add a test at the
level where the behaviour lives.

## Style

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
| `quiet period (frozen surfaces)` | no versioned surface moved (see below) |
| `typescript (typecheck, test, build)` | the shared core, the CLI, and the UI |
| `integration (CLI, no engine)` | the whole command line works, end to end |
| `corpus replay (parsers never panic)` | the saved fuzz inputs still behave |
| `docs (claims, surface, reference)` | the docs still describe this build |
| `desktop (typecheck, UI bundle, shell check)` | the window builds |
| `packaging (version agreement, staged layout)` | a package runs after install |

**The quiet-period check knows where the countdown starts.** It carries the
release the countdown restarted from (`restart_release`, currently `0.8.0`):

- newest tag below it — a deliberate break is in flight, so surface work is
  expected; the check says so and passes;
- newest tag at or above it — any change to a frozen surface fails, so tagging
  the reset release is what turns enforcement on;
- a waiver with nothing to waive — fails, because a check that cannot fail is
  not a check.

A *new* deliberate break sets `ALLOW_SURFACE_CHANGE` with its reason for the
commit that ships it, then tags that release and moves `restart_release` in the
same change. Do not leave the variable set: the third rule will catch it.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md) for the private
channel and what is in scope.
