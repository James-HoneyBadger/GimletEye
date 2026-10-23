# Documentation

| Document | Read it when you want to… |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the layers, contracts, and dependency rules |
| [PLUGIN_SDK.md](PLUGIN_SDK.md) | write a pack in Perl, Python, Node, Go, or Rust |
| [MIGRATION.md](MIGRATION.md) | know what moves from which project, in what order |
| [ROADMAP.md](ROADMAP.md) | see phases and their acceptance criteria |
| [adr/](adr/) | understand why a decision was made and what it cost |
| [../SECURITY.md](../SECURITY.md) | review the threat model and data-handling guarantees |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | set up a development environment and open a change |

## Reading order for a new contributor

1. `README.md` — run it.
2. `ARCHITECTURE.md` §3–§4 — the two rules that matter (dependency direction,
   the `Report` contract).
3. The smallest complete example: `crates/crypto/src/hash.rs` (a tool with
   arguments and a test).
4. A pack: `plugins/perlden-pack/pack.pl`.
5. `PLUGIN_SDK.md` before writing your own.

## Conventions

- Tool ids are `category.kebab-case` (`sysadmin.disk-usage`).
- Every tool documents its arguments in the manifest; the UI renders from them.
- A tool that reports a problem emits a finding with a severity; it does not
  print.
- A tool that writes honours `ctx.dry_run`.
- Parsers are pure functions with fixture-based tests.
