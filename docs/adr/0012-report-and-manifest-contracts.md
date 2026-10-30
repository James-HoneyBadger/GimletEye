# 0012 — The report and manifest are versioned contracts

- **Status:** Accepted — 2026-10-29
- **Date:** 2026-10-29
- **Depends on:** [0002](0002-single-report-contract.md) (one report contract for
  every tool), [0006](0006-what-1.0-promises.md) (what 1.0 promises)

## Context

[0002](0002-single-report-contract.md) made every tool return the same `Report`,
and the surfaces render it without tool-specific code. That decision was written
for humans reading it. 1.0 also promises machine consumers: `check-release-gates.sh`
reads reports, the audit ledger will read reports, and a user's CI script will
parse `gimlet run --json` output.

Those consumers need three things a prose type cannot give them:

1. **Something to validate against**, without installing this project.
2. **A rule for what may change.** `status` gaining a fourth value would break
   every script that switches on it, but nothing in the repository would notice.
3. **A way to tell which shape a report is.** Today a 1.0 report and a 1.1
   report are indistinguishable.

There is also a hole worth naming: `Report` has no version, no tool version, no
timestamp, and no host. A report copied out of a terminal cannot be dated or
attributed, which matters for a forensics tool.

## Decision

### 1. Two schema files are the contract

`docs/schema/report.schema.json` and `docs/schema/manifest.schema.json`, both
draft-07, both `additionalProperties: false`. They are published with the
release and are part of the public surface in the sense of
[0006](0006-what-1.0-promises.md): a change to them is a change to the product.

They describe the **1.0** shape — exactly the fields `Report` and
`ToolManifest` have today, no more.

### 2. Tests hold the schema to the code

`packages/core/test/contract-schema.test.ts` compiles both schemas and:

- validates a golden report (`test/fixtures/report-golden.json`) that carries
  every declared field, and asserts its key set equals the schema's property
  set — so a new field on `Report` cannot land without a schema and fixture
  update;
- validates every manifest in `NODE_TOOLS`, so a tool cannot declare an
  argument type, capability, category, or data shape the contract does not
  admit;
- refuses the shapes the contract rules out: unknown `status`, unknown
  `severity`, a finding without a `code`, a non-numeric `duration_ms`, an
  undeclared envelope field, an unknown capability, an unknown argument type, a
  `data` object shape without its `required` map.

### 3. Additive changes are free; the rest are not

- **Adding an optional field** is a minor. Readers must ignore fields they do
  not know; that is the price of ever being able to add one.
- **Changing the meaning of an existing field**, narrowing an enum, tightening a
  constraint, or removing a field is a major. `status` keeps its three values.
- **`report_version`** is the escape hatch: when consumer-visible semantics
  change, a new schema file and a new number arrive together.

The backwards rule is stated for consumers in `docs/COMPATIBILITY.md`.

### 4. The envelope lands in 1.1, as an additive change

These fields are agreed and **deferred**:

| Where | Field | Meaning |
|---|---|---|
| report | `report_version` | integer; `1` today, `2` the first time semantics change |
| report | `tool_version` | the `version.ts` string that produced the report |
| report | `generated_at` | ISO-8601 UTC timestamp of the run |
| report | `host` | `hostname`, `platform`, `arch` |
| manifest | `since` | the version a tool first shipped in |
| manifest | `deprecated`, `replaced_by` | retirement without removal |
| manifest | `examples` | one runnable invocation |
| manifest | `args[].secret` | replaces name-pattern inference |

Why not now: `packages/core/src/report.ts` and `manifest.ts` are on the
quiet-period frozen list, and any diff there restarts the two-release countdown
(see `docs/ROADMAP.md`). A version field that is added *additively* — optional,
ignored by 1.0 readers — does not need the freeze restarted at all, so there is
nothing to gain by taking the cost now and losing a release of quiet.

Every field above is optional and additive, which is why 1.0 can ship a
`additionalProperties: false` schema and 1.1 can relax exactly one line of it
without breaking anyone.

## Alternatives considered

**Put `report_version` in the schema now, before the field exists.** Rejected: a
schema that declares a field no producer writes is a lie that consumers will
code against. The schema describes what is emitted.

**Leave `additionalProperties` open, so new fields never break a validator.**
Rejected: then the schema cannot catch a typo in a tool's own `data`, which is
the failure mode that matters most in practice. Strictness now, relaxation with
the version bump.

**Version the package instead of the report.** Rejected: a report outlives the
binary that wrote it — it gets pasted into a ticket. The version has to travel
with the artifact.

**Generate the schema from the TypeScript types.** Rejected for 1.0: it needs a
new dependency, it emits a schema that follows internal names rather than the
promise, and the two files are 90 lines. Revisit if a third one appears.

## Consequences

- Consumers can validate today without reading this repository.
- `docs/TOOL_REFERENCE.md` and the schemas now have to agree with the
  manifests; the manifests are validated, and the reference is generated from
  them.
- 1.1's envelope is a known, written-down, additive change rather than an
  improvisation, and adopting it costs one review rather than a design
  argument.
- `additionalProperties: false` is a promise to break at 2.0, not 1.1. The
  version field is what makes that acceptable.
