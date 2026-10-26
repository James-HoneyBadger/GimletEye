# Documentation

| Document | Read it when you want to… |
|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | use the toolkit: every command and tool, with real output |
| [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | install it, configure it, secure the API, trust packs, back up state |
| [PACK_GALLERY.md](PACK_GALLERY.md) | write a pack from an empty directory |
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the layers, contracts, and dependency rules |
| [PLUGIN_SDK.md](PLUGIN_SDK.md) | write a pack in Perl, Python, Node, Go, or Rust |
| [CONTAINER.md](CONTAINER.md) | read or implement the `.melv` encrypted file format |
| [COMPATIBILITY.md](COMPATIBILITY.md) | check what is public API, how deprecation works, how rollback works |
| [PROVENANCE.md](PROVENANCE.md) | find out where a module began (maintainer note) |
| [ROADMAP.md](ROADMAP.md) | see phases and their acceptance criteria |
| [ENHANCEMENTS.md](ENHANCEMENTS.md) | pick the next feature; effort and risk per item |
| [adr/](adr/) | understand why a decision was made and what it cost |
| [../SECURITY.md](../SECURITY.md) | review the threat model and data-handling guarantees |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | set up a development environment and open a change |

## Reading order for a new contributor

1. `README.md` — run it.
2. `ARCHITECTURE.md` §3–§4 — the two rules that matter (dependency direction,
   the `Report` contract).
3. The smallest complete example: `crates/crypto/src/hash.rs` (a tool with
   arguments and a test).
4. A pack: `plugins/perlden-pack/pack.pl` (an optional compatibility adapter).
5. `PLUGIN_SDK.md` before writing your own.

## Conventions

- Tool ids are `category.kebab-case` (`sysadmin.disk-usage`).
- Every tool documents its arguments in the manifest; the UI renders from them.
- A tool that reports a problem emits a finding with a severity; it does not
  print.
- A tool that writes honours `ctx.dry_run`.
- Parsers are pure functions with fixture-based tests.
