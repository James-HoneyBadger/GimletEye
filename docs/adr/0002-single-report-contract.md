# 0002 — One `Report` type for every tool

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The source projects each invent a result shape:

- Perl Den: `\%result` plus a separate `format_report(\%result)` string renderer.
- HB_Scrub: `{ data, format, removedMetadata, originalSize, cleanedSize, warnings }`.
- DarkStar: typed service results plus an audit record.

Any surface that wants to show "what happened" must special-case each shape —
which is exactly how the three projects ended up with three CLIs, three GUIs,
and three output formats.

## Decision

Define one `Report`:

```rust
Report {
    tool: String,
    status: Status,
    summary: String,
    findings: Vec<Finding>,
    data: serde_json::Value,
    body: Option<String>,
    warnings: Vec<String>,
    duration_ms: u64,
}
```

Two non-obvious choices:

1. **`status` is derived from findings** (`Report::sealed()`), never asserted by
   the tool. A tool cannot claim success while emitting a `high` finding.
2. **`body` is separate from `data`.** `data` is the machine channel; `body` is
   optional human text. This is what lets a Perl module return its formatted
   report *and* structured data without either consumer parsing the other.

## Consequences

**Positive**

- One renderer serves text, JSON, Markdown, and CSV; one HTTP response; one UI
  component.
- Findings give every tool a uniform severity vocabulary, which the UI, audit
  log, and a future policy engine can all use.
- A compat pack can return a legacy formatted report verbatim in `body`.

**Negative**

- Findings are a lossy model for unusual outputs; anything not expressible goes
  into `data`, which pushes structure back to consumers.
- `body` can duplicate `data`, inflating payloads slightly.

**Rejected alternatives**

- **Per-tool result types:** forces every surface to know every tool.
- **Free-form JSON only:** no consistent severity, no CI-friendly verdict, and
  the UI would have to guess how to render.
