# Architecture decision records

Short records of decisions that are expensive to reverse. Each states the
context, the decision, and what it costs.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-rust-spine-with-polyglot-packs.md) | Rust workspace as the spine; other languages join as out-of-process packs | Accepted |
| [0002](0002-single-report-contract.md) | One `Report` type for every tool, everywhere | Accepted |
| [0003](0003-one-ui-for-all-surfaces.md) | One TypeScript UI, rendered by Tauri and by the browser | Accepted |
| [0004](0004-namespaced-configuration.md) | One TOML config with module-owned namespaces | Accepted |
