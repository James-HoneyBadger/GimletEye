# Documentation

| Document | Read it when you want to… |
|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | use the toolkit: workflows, and the commands worth typing |
| [TOOL_REFERENCE.md](TOOL_REFERENCE.md) | look up one tool: its arguments, an example, and the output it produced |
| [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | install it, configure it, back up state |
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the layers, contracts, and dependency rules |
| [CONTAINER.md](CONTAINER.md) | read or implement the `.gimlet` encrypted file format |
| [COMPATIBILITY.md](COMPATIBILITY.md) | check what is public API, how deprecation works, what was removed |
| [PROVENANCE.md](PROVENANCE.md) | find out where a module began (maintainer note) |
| [ROADMAP.md](ROADMAP.md) | see phases and their acceptance criteria |
| [ENHANCEMENTS.md](ENHANCEMENTS.md) | pick the next feature; effort and risk per item |
| [adr/](adr/) | understand why a decision was made and what it cost |
| [../SECURITY.md](../SECURITY.md) | review the threat model and data-handling guarantees |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | set up a development environment and open a change |

## Reading order for a new contributor

1. `README.md` — run it.
2. `ARCHITECTURE.md` §2–§4 — the layers, the tool contract, and why there is
   one implementation.
3. The smallest complete example of each kind of tool:
   - TypeScript: `packages/core/src/tools/disk-usage.ts`
   - engine: `packages/engine/src/signing.ts`
4. `ADR 0008` before proposing a new surface or a new extension point.

## Conventions

- Tool ids are `category.kebab-case` (`sysadmin.disk-usage`).
- Every tool documents its arguments in the manifest; both surfaces render from
  it.
- A tool that reports a problem emits a finding with a severity; it does not
  print.
- A tool that writes honours the dry-run flag it is given.
- Parsers are pure functions with fixture-based tests.
