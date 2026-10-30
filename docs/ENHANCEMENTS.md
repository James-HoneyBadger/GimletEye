# Enhancements and feature proposals

A prioritized backlog beyond [ROADMAP.md](ROADMAP.md). Each item states the
problem, why it matters, and a rough effort so it can be argued with rather than
guessed at.

Effort: **S** ≤ 1 day · **M** ≤ 1 week · **L** > 1 week.
Risk is about user-visible damage if the work goes wrong, not difficulty.

> The Rust era ended with [ADR 0010](adr/0010-retire-rust.md); everything below
> is about the TypeScript tree. Effort and risk are for one maintainer, focused.

---

## The next five

Ordered by value per unit of risk. Everything else can wait.

| # | Item | Why now | Effort | Risk |
|---|---|---|---|---|
| 1 | ~~[Observe declared capabilities](#4-observe-declared-capabilities)~~ | **Shipped**: the runtime hands each built-in tool a guarded `Host`. | — | — |
| 2 | [The audit trail as a ledger](#6-the-audit-trail-as-a-ledger) | `batch` can evict a trail's whole history, and a trail without a run id or `dry_run` cannot answer "what happened". | M | Low |
| 3 | [Render snapshots before the freeze](#8-render-snapshots-before-the-freeze) | 1.0 promises `Report` output; a snapshot per format makes a renderer change visible instead of argued about. | S | Low |
| 4 | [Native parsers for the remaining formats](#2-native-parsers-for-the-remaining-formats) | Format parity is a parser each, and the format people ask for first (GIF) is the cheapest. | L | Medium |
| 5 | [Scheduled runs](#5-scheduled-runs) | The engine can repeat work per file; the next ask is per hour. | M | Medium |

Shipped since this list was first written: **batch execution**, **manifest
`mutates`**, the **UI test suite**, the **TUI**, **completions and a man page**,
the **five audits**, `--output`/`--quiet`, the **golden corpus** with its
no-growth and idempotence properties, the **TypeScript fuzz targets** with their
soak ledger, and — in the 0.9.1 patch — **secret-argument masking**, **secret
files created `0600`**, a **validated engine report**, and a desktop **content
policy that cancels non-local requests**. Since then: the **argument gate**,
**capability enforcement**, and the engine **manifest boundary check**. The HTTP
API, its bearer token, and the pack protocol were removed at 0.8; no item below
assumes a pack.

---

## Crypto, privacy, and metadata

### 1. Finish the key lifecycle

**Problem.** The primitives and the container are done; the lifecycle around
them is not. A key has no expiry, no strength audit, and no way to be split or
destroyed, and a v3 container does not say who sent it.

**Done.** Authenticated encryption (AES-256-GCM, ChaCha20-Poly1305), Argon2id
key derivation, Ed25519 signing, and the chunked `.gimlet` container (v1, v2, v3
— see [ADR 0005](adr/0005-chunked-container-v2.md)); the sealed keystore,
X25519 recipients, and OpenPGP interop through the system `gpg`
([ADR 0007](adr/0007-keystore-and-recipients.md)).

**Remaining.** Each of these touches `engine/keystore.ts` or `engine/keys.ts`,
which the 1.0 quiet period freezes until after 1.1 — landing one now would
restart the countdown, so they are planned rather than pending:
1. **Container v4: optional sender authenticity.** v3 lets anyone holding Alice's
   public key produce a file she will open, and it names nobody. A signature over
   the authenticated header, carrying the signer, answers "who sent this".
2. **Key expiry and `crypto.key-audit`** — expired, weak, or duplicated entries.
   (`crypto.pass-audit` covers the password half; this is the key half.)
3. **Shamir split/combine and secure shred**, with `--dry-run` by default.
   Shred is host-only and could land sooner; secret sharing needs `keys.ts`.
4. **RSA recipients** — X25519 covers the modern case; RSA is for talking to
   older tooling and survives review only if it earns its weight.

**Effort** L · **Risk** High — a container or key-format regression here is
unrecoverable data loss. Every change needs a golden fixture and an ADR.

### 2. Native parsers for the remaining formats

**Problem.** Native support covers JPEG, PNG, and WebP. HEIC, AVIF, TIFF, PDF,
MP4, RAW, GIF, and SVG all return `unsupported`.

**Why.** There is no pack to borrow a parser from — the plugin protocol was
removed at 0.8 — so parity means writing it here, next to the corpus and the
fixtures, which is where the other three live. This is the largest open item and
the one most likely to want an ADR.

**Shape.** One module per format in `packages/engine/src/scrub`, each with a
fixture, a golden case, and the `scan`/`strip`/`verify` triple the other three
share, plus a manifest entry. **Order matters:** GIF (comment and application
blocks) and SVG (`<metadata>`, `<title>`, editor namespaces) are small parsers
with wide coverage and should land first; HEIC/AVIF/TIFF need a TIFF writer, and
PDF/MP4/RAW need a decision about scope before they need code. A format whose
parser would need a native dependency waits for that decision rather than
arriving as one.

**Effort** L · **Risk** Medium — a wrong parser silently corrupts bytes, which is
why the corpus requirement below comes with it.

### 3. Schedule the soak

**Done.** The golden corpus exists (`packages/engine/test/fixtures`, compared
whole in `scrub.test.ts`), including the properties that matter: a strip never
grows the file and never needs a second pass, and GPS redaction is idempotent.
The TypeScript targets (`scripts/fuzz.mjs`) and the soak harness
(`scripts/fuzz-soak.sh`, recorded in `fuzz/soak-ledger.jsonl`) replace the Rust
targets.

**Remaining.** No CI job runs the soak; it is a command a person remembers. The
adder for the ledger is already written (`scripts/check-fuzz-soak.sh`), so the
missing piece is a scheduled workflow that calls it — and a line in the README's
evidence table that stops saying the soak was not replaced.

**Effort** S · **Risk** Low.

### 4. Observe declared capabilities — shipped

**Done.** `packages/core/src/capabilities.ts` wraps the `Host` per built-in
run: a write without `fs:write` or a subprocess without `process:exec` is
`capability_denied`. Reads are not gated, and the engine's report is validated at
the boundary instead. A tool that declared both is passed the real Host, so the
wrapper costs nothing.

**Problem.** Every manifest declares capabilities (`fs:write`, `process:exec`,
`network`, `secrets`), and a test can check that the set is drawn from a known
list — but nothing checks that a tool *uses* only what it declared. A declaration
nothing checks is a comment, and this one is the security story for the desktop
shell and for a future scheduler.

**Why.** The declaration is the security story for the desktop shell and for a
future scheduler: a tool that writes files without saying so is the one that
matters.

**Shape.** Wrap the `Host` per tool run in an enforcing proxy: an `fs:write`
call from a tool that did not declare it throws `capability_denied` (the code
already exists in `errors.ts`, and nothing throws it today). The same wrapper, in
recording mode, lets a test compare what each tool touched with its manifest.
`network` has no implementation in `Host`, so the interesting rows are write,
exec, and secrets.

**Effort** M · **Risk** Low.

### 5. Scheduled runs

**Problem.** `gimlet batch` answers "clean this directory once". The next
request is always "do it every night", and today that means cron plus a shell
script that loses the audit trail.

**Why.** An audit trail only helps if the runs that matter are in it.

**Shape.** An `automation` module with `automation.schedule` tools: a job
definition (tool, args, cadence), a dry-run default, and a systemd-timer or
cron backend chosen per platform. The scheduler renders to the host's native
format rather than running its own daemon; the toolkit never stays resident.

**Effort** M · **Risk** Medium — a mis-scheduled mutating job is a data-loss bug,
so dry-run must be the default and the first run must be reported.

### 6. The audit trail as a ledger

**Problem.** The trail records the tool, the verdict, the duration, and the
argument *names*, which is the right kind of record. But one entry per file means
a `batch` over 2 000 photos evicts every other record at the 1 000-entry cap; an
entry carries no `dry_run`, no run id, no build version, and a second-precision
timestamp; trimming is a read-modify-write two processes can race; and `tail()`
reads the whole file to return the last twenty lines.

**Why.** "What happened on this host" is a promise the toolkit makes. A trail a
routine batch can erase is not evidence.

**Shape.**
- Entry: `id`, `ts` (milliseconds), `tool`, `status`, `duration_ms`, `dry_run`,
  `gimlet_version`, `platform`, `arg_keys`, and optionally `batch_id` and
  `report_sha256`.
- One summary entry per batch plus per-file entries sharing a `batch_id`, with a
  cap rule that never evicts a summary.
- Rotation into `audit.1.jsonl` instead of a racy rewrite; `tail()` reads
  backwards from the end.
- `gimlet audit --tool/--status/--since` and `gimlet audit verify`, which reports
  a truncated or non-monotonic trail. The desktop history panel gains the same
  filters.

**Effort** M · **Risk** Low — the entry shape is a contract, so it needs an ADR.

### 7. One gate for arguments — shipped

**Done.** `packages/core/src/validate.ts`, called from `Runtime.run`. Unknown
names, missing required values, enum membership, integer sign, and boolean shape
are one `invalid_args` failure; duplicate names stay last-wins by design. The
desktop keeps its field-level validator for per-field messages.

**Problem.** Argument rules are split between `packages/core/src/args.ts`
(coercion, read piecemeal by each tool) and `apps/desktop/src/lib/args.ts`
(required fields and integer shape). The runtime accepts any name:
`gimlet passgen length=12 bogus=1` reports `ok`, and a misspelled `in_place` or
`overwrite` silently changes what a destructive tool does. (Duplicate keys are
deliberately last-wins and pinned by a test, so that is not part of this item.)

**Shape.** `validateRun(manifest, args)` in `packages/core`, called from
`Runtime.run` before dispatch: unknown names, required presence, enum membership,
integer sign. It returns structured issues (`{arg, code, message}`) so the CLI,
the TUI, the desktop IPC, and `batch` render the same failure. Delete the
desktop's copy.

**Why now.** It turns "surfaces hold no logic" from a stated rule into an
enforced one, and it is a prerequisite for `secret` arguments.

### 8. Render snapshots before the freeze

**Problem.** `report.ts` holds the types, `sealed()`, and every renderer, and the
quiet-period check freezes the file whole. The markdown-escaping fix — a filename
with `|` ends the table row — therefore waits, and any renderer change is argued
about rather than shown.

**Shape.** Add golden snapshots for each format (`text`, `markdown`, `csv`,
`html`) over a fixed report with a hostile target, a long message, and an empty
data set. They pin what the freeze promises without moving a versioned file.

**Later.** Moving the renderers into `packages/core/src/render/` would let a
presentation fix stop being a surface change, but it moves `report.ts` and
restarts the quiet countdown — so it belongs in 1.1, with the markdown fix, not
before 1.0.

**Effort** S · **Risk** Low.

### Shipped: batch execution

`gimlet batch <tool> <path>...` expands files and directories, runs the tool
once per file with the path bound to `--input-arg`, and folds the results into
one aggregate report: counts, per-file status and summary, and a finding per
failing file. `--concurrency` bounds parallelism, `--fail-fast` stops after the
first failure (reporting what was skipped), and `--ext` narrows the file set.

It lives in the CLI rather than the privacy module because every tool benefits,
and it emits the same `Report` shape as everything else, so the JSON consumer
needs no special case.

### Other privacy items

| Item | Why | Effort |
|---|---|---|
| `privacy.verify-tree` | The CI use case — "fail this build if any file still carries GPS" — deserves a name, a schema, and a report, not a `batch` invocation assembled by hand. | S |
| `privacy.stego-scan` | Detects hidden payloads behind an image; cheap, distinctive, and fits the module. | S |
| Metadata injection | Writing a clean copyright/software/artist field is the counterpart to stripping. Needs the TIFF writer; risky. | M |
| Field-level decision report | Emit `decisions: [{segment, action, reason}]` so a compliance reviewer can see *why* each byte was kept or removed. | S |
| Streaming strip | Multi-GB video and RAW currently load fully into memory. | M |
| GPS redaction for RAW/HEIC/TIFF | Only JPEG/PNG/WebP today. | S–M each |
| Profile file | `--policy policies/redact.toml` for a shared, reviewable policy instead of ad-hoc flags; the policy's digest belongs in the report. | S |
| Input receipts | The SHA-256 of the input (and of the policy) in the strip report: the difference between "I cleaned a photo" and "I cleaned *this* photo". | S |
| Archives | A zip/tar of photos carries metadata inside; currently out of scope and easy to miss. | M |

### Markdown table escaping

**Problem.** `renderMarkdown` in `packages/core/src/report.ts` interpolates
finding messages and targets into a table without escaping. A filename may
legally contain `|`, and a tool may put a newline in its own text; either ends the
row and shifts every column after it, so `--format markdown` renders as noise
exactly when someone is pasting a report into an issue. CSV is already correct —
it quotes commas, quotes, and newlines.

**Why it is still open.** `report.ts` is a file the quiet-period check freezes,
and `ALLOW_SURFACE_CHANGE` restarts the two-release counter. The fix is two
lines; the freeze is a whole release.

**Do this instead.** Move `render`, `renderText`, `renderMarkdown`, `renderCsv`,
`renderHtml`, and the HTML stylesheet into `packages/core/src/render/`, leave
`report.ts` holding the types and `sealed()`, and guard the renderers with the
snapshots in §8. Then the quiet period freezes the *contract* and the *output*,
not the source layout, and a presentation fix stops being a surface change. Do it
in 1.1, not before 1.0: the move touches `report.ts` and restarts the countdown.

**Effort** S–M · **Risk** Low.

---

### ADR for profile semantics

**Problem.** `privacy`, `sharing`, and `archive` mean: privacy removes
identity/text/time, sharing keeps time, archive keeps all. That is a reasonable
design, but it is currently only documented in code
(`packages/engine/src/scrub/format.ts`).

**Why.** Users will build CI on these semantics. Write them down before v1.0.

**Effort** S · **Risk** Low.

---

## Crypto

| Item | Why | Effort |
|---|---|---|
| ~~`crypto.pass-audit`~~ | **Done in 0.9**: offline strength and pattern checks, never printing the password. | — |
| `crypto.key-audit` | Expired, weak, or duplicated keys in the keystore. Pairs naturally with the `sysadmin` audits. | M |
| `ArgSpec.secret` | A passphrase should not be representable as a plain string argument. The 0.9.1 patch masks by name; only the manifest can make it a rule for every surface. Needs an ADR. | M |
| Passphrase on stdin / hidden prompt | Closes the last path where a passphrase becomes `argv` (and therefore shell history). Sits beside `passphrase_env`. | S–M |
| Container v4, optional sender signature | v3 encrypts *to* someone and says nothing about who sent it. | L |
| Diceware passphrases | A four-word phrase beats `Xk9#mQ2!` for memorability, and the entropy arithmetic already exists in `passgen`. | S |
| Shamir split/combine | Secret sharing is a natural companion to key management, and a small wrapper. | S |
| Secure shred | Deletion that survives forensic recovery. Must be `--dry-run` first and require explicit confirmation. | S |
| QR export/import | Out-of-band key exchange without a network. Needs a terminal renderer plus UI support. | M |
| ~~OpenPGP interop tools~~ | **Done in 0.5** as `crypto.gpg-verify`/`crypto.gpg-encrypt` driving the system `gpg`; a Sequoia-backed implementation would remove the external dependency. | M |
| Post-quantum readiness | Track ML-KEM/ML-DSA support in `node:crypto` and `@noble`; do not implement primitives. | S now, L later |

---

## Sysadmin and automation

| Item | Why | Effort |
|---|---|---|
| ~~Port `FailedLoginDetector`, `FilePermissions`, `UserAudit`~~ | **Done in 0.9** as `sysadmin.failed-login-detector`, `sysadmin.file-permissions`, and `sysadmin.user-audit`. | — |
| `automation` module (scheduled runs) | Nothing schedules a job today. Prefer systemd timers on Linux, cron as fallback, `--dry-run` default. | L |
| ~~`sysadmin.config-drift`~~ | **Done in 0.9**: snapshot, diff, report drift as findings. | — |
| Five more audits | `suid-audit`, `world-writable`, `ssh-config-audit`, `scheduled-jobs` (cron and systemd timers), `firewall-summary`. Same shape as the five that shipped, and they are the most-used surface. | M |
| ~~Explicit platform contract~~ | **Done in 0.4**: `ToolManifest.platforms`, refused with `unsupported` on the wrong host. | — |
| macOS host tools | A `.dmg` ships, but `system-info`, `kernel-hardening`, `network`, and the login audit are Linux-only. `sysctl` and `launchd` variants would make the desktop app more than a crypto tool on a Mac. | M |
| Compose a pipeline | `scan → strip → verify` as one audited run with a JSON handoff between steps. Multi-step work is the real use case, and keeping it in the runtime keeps it in the trail. | M |

---

## Platform and surfaces

| Item | Why | Effort |
|---|---|---|
| WASM target | Metadata scan/strip, hashing, and password generation all work on bytes and would run in a browser with no upload. High privacy value. WebCrypto has no ChaCha20-Poly1305, so the container needs a noble fallback or must be AES-GCM-only there. | L |
| Windows CI job | A Windows zip and NSIS installer ship, but every CI job is `ubuntu-latest`. Path arithmetic in `batch` already normalises both separators; a typecheck + vitest job is what is missing. | M |
| Desktop batch | `batch` is the one capability with no desktop path: drag files or folders onto a tool and get the same aggregate report. | M |
| Verify after run | A button on a strip or encrypt result that runs `metadata-verify` / `crypto.inspect` on the output. Trust is built by showing the check. | S |
| ~~TUI~~ | **Shipped**: `gimlet tui`. | — |
| ~~Shell completions + man pages~~ | **Shipped in 0.9**: `gimlet completions <shell>` and `gimlet man`, generated from `packages/cli/src/surface.ts`. | — |
| ~~`--output <file>` and `--quiet`~~ | **Shipped in 0.9** as global flags, so `batch` and `doctor` honour them too. | — |
| Structured logging / OpenTelemetry spans | Turns "why was that slow" into a query. Every run already carries `duration_ms`; a span would say where it went. | M |

---

## Developer experience and quality

| Item | Why | Effort |
|---|---|---|
| ~~MSRV CI job~~ | gone with the Rust; the Node floor is `engines.node` and `setup-node`. | — |
| ~~End-to-end UI tests against a live engine~~ | **Shipped**: the `e2e` job drives the real window with Playwright. | — |
| ~~Benchmarks for large files~~ | **Shipped in 0.9**: `make bench` (`scripts/bench.mjs`) with floors for hashing, the container, and the scrub. | — |
| ~~Reproducible release artifacts~~ | **Shipped**: the `reproducible` job rebuilds and compares, and `SHA256SUMS` is signed. | — |
| Report JSON Schema export | `gimlet tools show --schema` emitting a schema from `DataSpec`, so a consumer stops hand-writing a parser and a field drift fails their build, not their production. | S |
| An SBOM over the npm tree | Signed artifacts and checksums exist; a bill of materials does not. | M |
| Docs site | Markdown is fine now; linked HTML with search pays off past ~10 documents. | M |

---

## Explicitly not doing

- **An IDE.** Gimlet Eye is a workbench, not an editor. Editors stay editors.
- **A hosted service.** Everything is local; a cloud mode would undo the privacy
  guarantee that makes the toolkit worth using.
- **Custom cryptographic primitives.** Wrap audited implementations; never
  implement AES, signatures, or KDFs here.

---

## How to propose something

Open an issue with: the tool id, the user problem, the smallest acceptable
behaviour, and what it must never do. Items that change a `Report` field, the
CLI surface, or the on-disk format need an ADR first.
