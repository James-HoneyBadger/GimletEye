# 0002 — One `Report` type for every tool

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The three domains produce results in different shapes:

- A system check wants to show structured data **and** a formatted table.
- A privacy operation wants to report what it changed and what it could not.
- A crypto service returns typed values and writes an audit record.

If each tool defines its own result type, every surface must special-case every
tool. That is how a CLI, an HTTP API, and a UI end up with three renderers and
three definitions of "failed".

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
   optional human text. This lets a tool return a formatted report *and*
   structured data without either consumer parsing the other.

## Consequences

**Positive**

- One renderer serves text, JSON, Markdown, and CSV; one HTTP response; one UI
  component.
- Findings give every tool a uniform severity vocabulary, which the UI, audit
  log, `--strict` exit codes, and a future policy engine all share.
- A pack can return a formatted report verbatim in `body` while still exposing
  structured fields.

**Negative**

- Findings are a lossy model for unusual outputs; anything not expressible goes
  into `data`, which pushes structure back to consumers.
- `body` can duplicate `data`, inflating payloads slightly.

**Rejected alternatives**

- **Per-tool result types:** forces every surface to know every tool.
- **Free-form JSON only:** no consistent severity, no CI-friendly verdict, and
  the UI would have to guess how to render.
