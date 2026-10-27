# Architecture decision records

Each record is a decision that was not obvious, with the alternatives that were
considered and what it cost.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-rust-spine-with-polyglot-packs.md) | A Rust spine with polyglot packs | Superseded by 0008 |
| [0002](0002-single-report-contract.md) | One report contract for every tool | Accepted |
| [0003](0003-one-ui-for-all-surfaces.md) | One UI for all surfaces | Partly superseded by 0008 (the HTTP and browser surfaces are gone; the shared UI package became the desktop frontend) |
| [0004](0004-namespaced-configuration.md) | Namespaced configuration | Accepted |
| [0005](0005-chunked-container-v2.md) | A chunked container format | Accepted |
| [0006](0006-what-1.0-promises.md) | What 1.0 promises | Accepted |
| [0007](0007-keystore-and-recipients.md) | A keystore and recipient encryption | Accepted |
| [0008](0008-typescript-surfaces-rust-engine.md) | TypeScript surfaces over one Rust engine | Accepted |
| [0009](0009-four-surfaces.md) | Four surfaces, one contract | Accepted |
| [0010](0010-retire-rust.md) | Retire Rust | Proposed |
| [0011](0011-rust-free-application-platform.md) | A Rust-free application platform | Accepted |

A superseded record stays in place: the reasoning is still the reason the new
record exists.
