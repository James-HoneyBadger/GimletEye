# Architecture decision records

Short records of decisions that are expensive to reverse. Each states the
context, the decision, and what it costs.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-rust-spine-with-polyglot-packs.md) | Rust workspace as the spine; other languages join as out-of-process packs | Accepted |
| [0002](0002-single-report-contract.md) | One `Report` type for every tool, everywhere | Accepted |
| [0003](0003-one-ui-for-all-surfaces.md) | One TypeScript UI, rendered by Tauri and by the browser | Accepted |
| [0004](0004-namespaced-configuration.md) | One TOML config with module-owned namespaces | Accepted |
| [0005](0005-chunked-container-v2.md) | Chunked `.melv` v2 so memory is bounded by the chunk size, not the file | Accepted |
| [0006](0006-what-1.0-promises.md) | 1.0 is a contract release: five gates and a two-release quiet period before the freeze | Proposed |
