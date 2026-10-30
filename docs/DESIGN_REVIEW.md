# Design review — Gimlet Eye 0.9.0

**Date:** 2026-10-29 · **Tree:** `ab2d08b` (0.9.0, latest tag v0.8.0) · **Method:**
read the packages, the ADRs and the gates, then ran the built CLI against the
documented examples and against inputs designed to break the contract.

This is a review, not a redesign. The spine is sound and the corrections below
are small relative to it. Three of them are defects a user can hit today.

> **Patch status (2026-10-29).** Fixed in this tree: D1, D2, D4, D5, D6, D8,
> D11, the masking half of D3, and the documentation drift in D12; also the
> function-level items in `optInteger`, `samePath`, `passgen`, `strip`, and the
> engine manifest boundary. Partly fixed: D7 (private CSPRNG temporary names;
> the compare-and-swap is still open). Open: D3's `secret` argument kind, D9,
> D10, D13, and the two frozen-file items (`sealed()` and `generateKeyPair`).

---

## 1. Verdict

| Area | Assessment |
|---|---|
| Layering (`core` → `engine`, surfaces import, no RPC) | **Strong.** The one-directional dependency and the `Host` boundary are the reason the rest works. |
| Tool/report contract | **Strong idea, one gate too weak.** `sealed()` and `assertDataShape()` are the right choke points; the schema gate is bypassed by the tests that would catch its own bugs. |
| Destructive paths (encrypt, strip, keys) | **Careful and consistent.** Refuse-same-path, never-overwrite, temp+rename, verify-before-write. Permission handling has two gaps. |
| Crypto | **Good primitives, honest format.** Header-as-AAD, validated KDF parameters, one error for wrong-key-and-corrupt. Missing sender authenticity in v3. |
| Secrets handling | **The weakest area.** The CLI, TUI and desktop all render or copy passphrases, and the docs claim otherwise. |
| Configuration and state | **Simple and versioned.** One root, one file. Legacy keystore migration is dead code. |
| Gates and evidence | **Above average, with a documented blind spot:** green gates coexist with a broken documented command. |

---

## 2. What the design gets right

These are worth keeping exactly as they are, because most of the proposed work
below depends on them:

1. **`Runtime.run` is the only door.** Audit completeness, the platform gate and
   the data-shape gate all live in one place (`packages/core/src/runtime.ts`).
   The e2e test asserting a run reaches `audit.jsonl` is the right test.
2. **Status is derived, never declared.** `sealed()` makes "high finding reported
   as ok" unrepresentable for built-in tools.
3. **`Report.data` is declared and checked.** Most projects have a report shape;
   few fail the run when a tool drifts from it.
4. **The engine is not an extension point.** No manifest that names a command, no
   discovery of user code. This removes a whole class of problems by decision
   rather than by audit.
5. **Bounded memory is structural.** `ChunkSealer`/`ChunkOpener` with one held
   chunk is the right shape, and the whole-buffer reader being the streaming
   reader fed once means the two cannot drift.
6. **Destructive tools refuse more than they accept** (`refuseSamePath`,
   `overwrite=false`, `in_place` explicit, re-scan before writing the strip).
7. **The gates are unusual and valuable:** readme-claims, data-schema, public
   surface, quiet period, mutation sweep, honest "known limitations" sections.

---

## 3. Verified defects

Reproduction commands are in [§8](#8-appendix-reproduction). Severity is
user-visible impact, not effort.

### D1 — `crypto.keygen` to files always reports an internal error (High)

The manifest declares two fields that the tool cannot satisfy on its success
path (`packages/core/src/tools/keys.ts:96`):

```ts
public_path: 'null',
secret_path: 'null',
```

but the file branch returns strings, and `id` is declared `string` while it
returns `null`. `assertDataShape()` therefore rejects a successful run:

```
$ gimlet keygen label=probe dir=/tmp/probe/keys
gimlet: internal error: crypto.keygen reported data that does not match its
schema: data.id should be string but is null; data.public_path should be null
but is string; data.secret_path should be null but is string
exit=1
```

The key files **are written** (mode 0600) before the report is rejected, so the
user is told the run failed while the key exists. `docs/USER_GUIDE.md` documents
this path ("Without `keystore=true` the key is written as two files"), and
ADR 0007 depends on it.

Why nothing caught it:

- `check-data-schema.sh` compares only the **documented examples**, and the
  `crypto.keygen` example uses `keystore=true` (`scripts/tool-reference.py:55`).
- `packages/core/test/keys.test.ts` calls `generateKey.run(...)` directly, so it
  never passes through the runtime gate that `data-schema.test.ts` tests with a
  synthetic tool.
- The schema was generated from a dry run, where `null` is correct.

**Fix (S, no frozen surface):** declare `id: 'string|null'`,
`public_path: 'string|null'`, `secret_path: 'string|null'`; add a file-mode
example to `tool-reference.py`; and add one test that runs every shipped tool
through `Runtime.run` rather than `.run()`.

### D2 — The pre-rename keystore is never opened (Medium)

`keystorePath()` in `packages/core/src/paths.ts` is exported, tested, and called
by nothing. Every keystore tool and `crypto.keygen` read
`ctx.paths.keystoreFile` directly. A user whose only store is
`~/.config/mellivora/keystore.melv` gets "no keystore at
…/mellivora/keystore.gimlet", which is exactly the stranding
`docs/ARCHITECTURE.md` §6 says cannot happen.

**Fix (S):** resolve the store through `keystorePath(paths, host)` in
`openStore`/`writeStore`/`generateKey`. (Writing to the legacy name for a legacy
home is correct; writing `keystore.gimlet` beside it is not.)

### D3 — Passphrases are displayed and copied (High, product-level)

- The desktop renders every `string` argument as `<input type="text">`
  (`apps/desktop/src/components/workbench.ts`), so a passphrase is on screen.
- The TUI echoes the argument line it is typing (`packages/cli/src/tui/render.ts`),
  so a keystore passphrase scrolls through terminal history and any session
  recording.
- `cliCommand()` (`apps/desktop/src/lib/format.ts`) builds the "equivalent
  command" from **all** argument values, and `result.ts` puts it in the copy
  button and its `title` tooltip: a keystore passphrase goes to the clipboard in
  plaintext.
- Only `passphrase_env` avoids this, and it is meaningless in the desktop, where
  the environment belongs to the app, not the user's shell.

This contradicts `docs/ARCHITECTURE.md` §5 and `apps/desktop/src/lib/bridge.ts`
("a passphrase never enters a webview") and SECURITY.md control 7 ("prompted
for" — no prompt exists).

**Fix, staged:**

1. *Now (S, no surface change):* mask any argument whose name matches
   `/(passphrase|secret|token|pin|password)/i` in the desktop form and the TUI;
   omit those values from `cliCommand()` (emit `passphrase_env=…` or
   `<hidden>`) and from the tooltip.
2. *1.1 (manifest change, ADR):* add `ArgSpec.secret?: true`, and make it mean
   three things: masked input, redacted in any generated command, and never
   written to a draft or the report.
3. *Also now:* `passphrase_stdin=true` (read once from stdin) and a hidden
   prompt for `crypto.encrypt`/`crypto.decrypt`/keystore tools, so there is a
   safe path that uses neither argv nor the environment.

### D4 — Argument validation is duplicated, and does not exist at the choke point (Medium)

Two independent validators exist: `packages/core/src/args.ts` (used piecemeal by
each tool) and `apps/desktop/src/lib/args.ts`. Neither rejects what a user can
type, and the runtime accepts anything:

```
$ gimlet sha256 text=hello text=bye     # duplicate key, silently last-wins
$ gimlet passgen length=12 bogus=1      # unknown argument, silently ignored
```

Both run and report `ok`. A typo in `in_place`, `overwrite` or `redact_gps`
therefore silently changes what the tool does.

**Fix (M):** one `validateRun(manifest, args)` in `packages/core`, called from
`Runtime.run` before dispatch, returning structured issues
(`{arg, code, message}`). It checks unknown names, required presence, enum
membership, integer sign — the rules the desktop already encodes — and rejects a
duplicate pair at parse time in `fromPairs`. Delete the desktop copy. This is
the single highest-value refactor in the review: it turns "surfaces hold no
logic" from a stated rule into an enforced one.

**Landed.** `packages/core/src/validate.ts`, called from `Runtime.run`; unknown
names, missing required values, enum membership, integer sign, and boolean shape
now fail with one `invalid_args` message. Duplicate names remain last-wins by
design. The desktop keeps its field-level validator for per-field messages.

### D5 — A usage error escapes as `internal` and exits 1 (Low)

```
$ gimlet tools list --category nope
gimlet: Error: unknown category 'nope'
exit=1
```

`parseCategory` throws a plain `Error`, which the top-level handler wraps as
`internal`. `docs/COMPATIBILITY.md` promises exit `2` for "a command typed
wrong", and the message leaks the `Error:` prefix.

**Fix (S):** make `parseCategory` throw `invalidArgs`, and map `not_found` for a
**tool id** to 2 (a mistyped tool is usage; a missing file is not). Splitting
`unknown_tool` from `not_found` is the cleanest way to keep both honest.

### D6 — Three write paths are weaker than their neighbours (Medium)

| Path | Problem |
|---|---|
| `crypto.keygen` → secret file | `writeTextFile()` then `chmodOwnerOnly()`: the file is briefly `0644`, and stays `0644` if the chmod fails. |
| `crypto.key-export secret=true` | Same. SECURITY.md says the secret half is written with mode 0600; it is *renamed into* 0600, not *created* 0600. |
| `crypto.decrypt` of a **v1** container | `writeOutput()` writes the plaintext directly to the destination — no temp+rename (v2/v3 do), and no mode control, so decrypted data can land `0644`. |

`keystore.save()` already shows the correct pattern (`openFile(temp,'w',0o600)`,
`sync`, `rename`, `chmod`); the tools should use it.

**Fix (S):** add `Host.writeFileMode(path, bytes, mode)` (or `createFile`) and use
it for every secret/plaintext write; route the v1 decrypt through the same
temp+rename path as v2/v3 and default new plaintext to `0600`.

### D7 — Fixed temporary-file names race (Medium, keystore is the dangerous one)

`sealToFile`, `openToFile`, `writeSealed`, `writeStore` all use
`${destination}.tmp`. Two processes writing the same store — the CLI and the
open desktop — write the same temp path, and the second `rename` publishes a
file built from a store the first process never saw. The keystore's whole job is
to not lose keys; a lost update here is silent.

**Fix (S):** temp name with pid+random (`<path>.<pid>.<rand>.tmp`), and a
compare-and-swap on the store before rename (mtime or content digest), failing
with "the keystore changed while it was open; retry" rather than overwriting.

### D8 — The engine's report is trusted more than a built-in tool's (Medium)

`assertReport()` in `packages/core/src/sidecar.ts` checks only that `status` and
`summary` are strings. A sidecar report is neither re-`sealed()` nor checked
against a severity enum, and `sealed()` turns an unknown severity into `ok`
(`SEVERITY_ORDER[unknown]` is `undefined`, `Math.max` yields `NaN`, every
comparison is false).

**Fix (S):** re-seal every report in `Runtime.execute` (idempotent for built-in
tools) and validate `status ∈ {ok,warning,error}` and
`severity ∈ {info,low,medium,high,critical}` in `sidecar.ts`. Both files are
outside the frozen set.

### D9 — Markdown findings are still unescaped (Low, known, frozen)

`renderMarkdown` interpolates `message`, `code` and `target` into a table row
without escaping `|` or newlines, so a filename containing `|` breaks every
subsequent column. `docs/ENHANCEMENTS.md` records this and defers it because
`packages/core/src/report.ts` is frozen since v0.8.0. That is a defensible
decision; the review's recommendation is in [§4.6](#46-un-freeze-the-contract-not-the-rendering).

### D10 — The audit trail is a file, not a ledger (Medium)

- `record()` reads the whole trail after every append (`trimIfLarge` → `readAll`),
  so a run costs O(trail).
- `tail()` reads the whole trail to return the last N.
- Trimming is a read-modify-write; two concurrent trims can drop an entry (the
  code says so).
- Entries carry no schema version, no `dry_run`, no build version, no run id,
  and timestamps are second-precision, so they are neither unique nor ordered.
- **Batch floods it:** one entry per file against `max_entries = 1000`. A 2 000
  photo run evicts every record of everything else, including the batch's own
  reason for existing.

**Fix:** see [§4.4](#44-make-the-audit-trail-a-ledger). Low effort, high value
for the "what happened on this host" claim.

### D11 — The desktop has no content policy and no network block (Medium)

`apps/desktop/index.html` sets no CSP, `main.ts` sets no
`onHeadersReceived` policy, and nothing cancels network requests. The renderer
is `sandbox: true` with `contextIsolation`, which contains the blast radius, but
the headline claim is "nothing opens a socket" — worth enforcing at the session
rather than inferring it from the code.

Also missing: `webPreferences.spellcheck: false` (Chromium's spellchecker is a
network/download surface on some platforms) and `app.enableSandbox()`.

**Fix (S):** a meta CSP in `index.html` (`default-src 'none'; script-src 'self';
style-src 'self' 'unsafe-inline'; img-src 'self' data:`), a
`webRequest.onBeforeRequest` cancel for non-`file:` schemes, `spellcheck: false`,
and an e2e assertion that an outbound request never leaves.

### D12 — Documentation has drifted from the code (Low, but it is the product)

| Claim | Reality |
|---|---|
| SECURITY.md: "Key material is zeroed as far as JavaScript allows… Buffers are overwritten after use" | No `.fill(0)` exists anywhere in `packages/`. |
| SECURITY.md control 7: passphrases are "read from an environment variable or prompted for" | No prompt exists in any surface. |
| SECURITY.md control 9: fuzzers live in `crates/scrub/fuzz` | The Rust is gone. |
| `packages/engine/src/scrub/index.ts`: "install a metadata pack" | Packs were removed at 0.8. |
| `packages/core/src/node.ts`: "The desktop gets the same tools from the engine over the sidecar" | `apps/desktop/electron/main.ts` registers `NODE_TOOLS` locally. |
| ENHANCEMENTS.md "next five" table | Row 5 (`Scheduled runs`) appears twice. |
| ARCHITECTURE §2: `@noble/hashes` is "the only runtime dependency" | `packages/core` also depends on `smol-toml`. |

**Fix (S):** a truth pass. Where zeroization matters, either add best-effort
`fill(0)` in `deriveKey`/`passphraseKey`/key generation and *say it is
best-effort*, or state plainly that JavaScript cannot promise it. Honesty is the
product here; a claim the code does not implement is worse than a limitation.

### D13 — Windows is claimed but untested, and path code assumes `/` (Medium)

`batch.ts` joins with `/` and extracts extensions with `lastIndexOf('/')`;
`keystore-tools.ts` `stem()` splits on `/`. On Windows a path like
`C:\photos\a.jpg` usually still works by accident, but a directory with a dot in
its name does not. There is no Windows CI job, while the README ships a Windows
zip and NSIS installer.

**Fix (M):** one `windows-latest` job running `typecheck` + `vitest` (not e2e),
and route the remaining string arithmetic through `pathutil`.

---

## 4. Design-level corrections

These are not bugs; they are places where the shape invites the bugs above.

### 4.1 One gate for arguments

Add `validateRun(manifest, args)` and call it from `Runtime.run` (see D4). The
CLI, TUI, desktop IPC and batch then share one rule set by construction, and the
desktop's `validateArgs` can be deleted. Keep coercion as it is: `fromPairs`'s
refusal to rewrite `0123`, `+5` and `-0` is exactly right.

### 4.2 Enforce declared capabilities

`Capability` is currently a comment with a type. Wrap the `Host` per tool run
with a recording/enforcing proxy: an `fs:write` call from a tool that did not
declare it throws `capability_denied` (a code that already exists in
`ErrorCode` and is currently unused). Use the same wrapper in tests to assert
each tool touches only what it declares — that is ENHANCEMENTS #4, done
structurally rather than as a one-off test.

### 4.3 Make secrets a first-class argument kind

Covered in D3. The design point: a passphrase should not be representable as a
plain `string` argument, because every surface that renders a string will render
it. `secret: true` also lets the report, the audit and the "repeat this run"
command agree on what must never be emitted.

### 4.4 Make the audit trail a ledger

- **Schema:** `{ v: 1, id, ts (ms, UTC), tool, status, duration_ms, dry_run,
  version, platform, arg_keys, batch_id?, report_sha256? }`.
- **Batch:** one entry per file is fine for forensics only if it is bounded.
  Emit per-file entries plus one `batch` summary sharing a `batch_id`, and give
  the cap a cohort rule ("never evict a batch summary").
- **Rotation:** when the trail exceeds the cap, rename to `audit.1.jsonl` and
  start fresh (or maintain a compacted tail), instead of a racy rewrite. `gimlet
  audit` reads the tail across segments.
- **Verify:** `gimlet audit verify` reports truncation (a missing line, a
  non-monotonic timestamp) — the thing a trail is actually for.
- **Read cheaply:** `tail()` should read backwards from the end
  (`readRange` is already on `Host`), and `trimIfLarge` should use `stat().size`
  as a fast path rather than parsing the file on every run.
- **Filter:** `gimlet audit --tool/--status/--since/--json`, and show it in the
  desktop history panel.

### 4.5 Report receipts

Record the SHA-256 of the input in `data` for `metadata-strip`, `crypto.encrypt`,
`crypto.sign` and `crypto.verify`, plus the policy digest for a strip. This is
the difference between "I cleaned a photo" and "I cleaned *this* photo, under
*this* policy, and here is the digest". `sha256Hex` already exists; the cost is
one extra read or hashing the buffer already in memory.

### 4.6 Un-freeze the contract, not the rendering

The quiet-period check freezes whole files, so a two-line table-escaping fix
restarts the 1.0 countdown. That is the wrong granularity: `Report` semantics are
the contract; the renderers are a view.

**Recommendation:** move `render`, `renderText`, `renderMarkdown`, `renderCsv`,
`renderHtml` and the HTML stylesheet into `packages/core/src/render/`, leave
`report.ts` holding only the types and `sealed()`, and guard rendering with
golden-output snapshots. Freeze `report.ts` (the shape) and `report.schema.json`
(the serialisation), not the presentation. This makes future presentation fixes
free.

### 4.7 Versioned report envelope (ADR for 1.1)

Add `report_version`, `tool_version`, `generated_at` and `host`
(`platform`, `arch`, `gimlet_version`). A report consumed by CI or attached to an
incident is evidence; evidence needs a time, a producer and a version. Also
publish the JSON Schema generated from `DataSpec` (`gimlet tools show --schema`),
so consumers stop hand-writing parsers.

### 4.8 Say what the crypto does not do

v3 encrypts to a recipient but does not authenticate the **sender**: anyone with
Alice's public key can produce a file she will open. For a toolkit aimed at
journalists and administrators, "who sent this" is often the question. A v4
header with an optional Ed25519 signature over the header (sign-then-encrypt,
with the signer's public key named in the authenticated header) closes it. This
needs an ADR and is a real feature, not a bug fix — but the current docs imply
more authenticity than the format provides.

---

## 5. Refinements

Smaller changes that improve coherence without new concepts:

1. **Prune empty categories.** `CATEGORIES` lists `forensics`, `automation` and
   `developer`; no tool uses any of them. Either populate (see §6) or remove
   until they exist. A category is a promise the UI quietly drops today.
2. **`tools list` should honour every format** or say which it supports; today
   `--format markdown` prints the text table.
3. **Batch summary in the report body.** The text output prints per-file lines
   then the report; the JSON consumer gets `data.files` with a different shape
   from every other report (`summary` present only on success). Give each entry
   the same `status/summary/findings` triple as a file report.
4. **Windows in `stem()`/`accepts()`/`joinPath()`** (D13), plus `pathutil`
   unit tests with `\` inputs.
5. **`audit.path` relative to `GIMLET_HOME`**, not the process CWD, and refuse a
   path inside `data/`/`cache/` where a cleanup could delete it.
6. **`config check`** (or `doctor` extension) that validates `[modules.*]`
   values instead of silently falling back on a typo.
7. **Search ranking** in the desktop: substring match only; `similarity()` is
   already there and would make `⌘K` forgiving of typos.
8. **`crypto.inspect --key <file>`**: say whether that key can open the file,
   without decrypting. Cheap, and it is the question a recipient actually has.
9. **TUI: exit 130 on Ctrl-C** (currently `finish(0)`), and do not echo secret
   arguments.
10. **Stale comment cleanup** (D12) — the docs are the security story here.

---

## 6. New features and functionality

Ordered by value ÷ risk. Effort S ≤ 1 day, M ≤ 1 week, L > 1 week.

### 6.1 Do first (patch release)

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | Fix `crypto.keygen` schema + add the file-mode path to the schema gate | A documented command currently fails after doing the work | S |
| 2 | Mask and redact secret arguments in all three surfaces | Passphrases are on screen, in the clipboard, and in terminal scrollback | S |
| 3 | Shared argument validation at the runtime gate | Silent typos on destructive tools | M |
| 4 | Wire `keystorePath()` (or delete it and the claim) | Migration story is false today | S |
| 5 | Create secret/plaintext files `0600`, never chmod after the fact | Narrow window, trivial fix, permanent habit | S |
| 6 | Desktop CSP, network block, `spellcheck: false` | Makes "no socket" structural rather than inferential | S |
| 7 | Doc truth pass | Undefended claims are the one thing this project cannot afford | S |

### 6.2 Complete the workbench (0.10)

| # | Item | Why | Effort |
|---|---|---|---|
| 8 | **Batch in the desktop** (drag files/folders onto a tool, same aggregate report) | `batch` is the one capability with no desktop path; "one workbench, two surfaces" is currently untrue for directories | M |
| 9 | **Verify-after-run** button on strip/encrypt results (runs `metadata-verify`/`crypto.inspect` on the output) | Trust is built by showing the check, not claiming it | S |
| 10 | **Metadata policy file** (`--policy redact.toml`) with a digest in the report | Reviewable, shareable policy; compliance needs "why" | M |
| 11 | **Field-level decision report** (`decisions: [{segment, action, reason}]`) | Already in ENHANCEMENTS and cheap; pairs with #10 | S |
| 12 | **`gimlet verify-tree <dir>`** (or `privacy.metadata-audit`) as a first-class tool | The CI use case (`batch … --strict`) deserves a name and a schema | S |
| 13 | **Audit filters + `audit verify`** | Trail becomes usable | S |
| 14 | **`tools show --schema`** (JSON Schema from `DataSpec`) | Stops consumers re-deriving the contract | S |
| 15 | **Windows CI job** + path fixes | The README ships Windows artifacts | M |
| 16 | **Capability enforcement at `Host`** | The declaration becomes the enforcement | M |
| 17 | **GIF and SVG scrubbers** | GIF comment/application blocks and SVG `<metadata>`/`<title>` are small parsers with large coverage; easier than HEIC and worth doing first | M |

### 6.3 Crypto pillar (1.1, with ADRs)

| # | Item | Why | Effort | Risk |
|---|---|---|---|---|
| 18 | **Secrets as arguments** (`ArgSpec.secret`) + hidden prompt + `passphrase_stdin` | Removes the last way a passphrase becomes argv | M | Low |
| 19 | **Container v4: optional sender signature** | "Who sent this?" is unanswered today | L | High |
| 20 | **Key expiry and `crypto.key-audit`** (expired, weak, duplicated) | The keystore can list and rotate but not advise | M | Low |
| 21 | **Diceware passphrases** (EFF wordlist, offline, entropy shown) | A 4-word phrase beats `Xk9#mQ2!` for memorability, and the entropy math is already there | S | Low |
| 22 | **Shamir split/combine** and **secure shred** (dry-run default) | Both are in ROADMAP; small wrappers over what exists | S–M | Medium |
| 23 | **`crypto.inspect --key`** | Answers "can this key open it?" without decrypting | S | Low |

### 6.4 Sysadmin and automation

| # | Item | Why | Effort |
|---|---|---|---|
| 24 | Five more audits: `sysadmin.suid-audit`, `world-writable`, `ssh-config-audit`, `scheduled-jobs` (cron + systemd timers), `firewall-summary` | The five shipped audits are the most-used surface; the next five have the same shape | M |
| 25 | **`automation.schedule`** rendering systemd timers / cron (no daemon, dry-run default) | ENHANCEMENTS #5, and it completes the `automation` category | M |
| 26 | **macOS variants** of `system-info` (sysctl) and `disk-usage` | The desktop ships a `.dmg` where most tools are `unsupported` | M |
| 27 | **Compose/pipeline**: `gimlet pipeline scan→strip→verify` with a JSON handoff | Multi-step work is the real use case; keeping it inside the runtime keeps it audited | M |

### 6.5 Platform

| # | Item | Why | Effort |
|---|---|---|---|
| 28 | **WASM target for scan/strip/hash/passgen** | Browser-side metadata stripping with no upload is the strongest possible demonstration of the privacy claim. Note: WebCrypto has no ChaCha20-Poly1305, so the container needs a noble cipher fallback or must be AES-GCM-only | L |
| 29 | **SBOM over the npm tree** (already in ENHANCEMENTS) | Signed artifacts exist; the bill of materials does not | M |
| 30 | **CI recipes**: a GitHub Action and a pre-commit hook running `metadata-verify --strict` | The shortest path from "tool" to "habit" | S |

---

## 7. Sequencing

The quiet period is running since v0.8.0 and currently green; 0.10 can be cut
without touching a versioned surface if the work above is ordered as follows.

1. **0.9.1 (patch):** D1, D2, D5, D6, D8, D11, D12 — all outside the frozen set.
   Fix D3 step 1 here too (UI/TUI masking and command redaction need no manifest
   change).
2. **0.10:** §4.1 argument gate, §4.4 audit ledger, §4.2 capability enforcement,
   §6.2 items 8–17, D13. No frozen file moves.
3. **1.0:** freeze. Add `report.schema.json` and golden-render snapshots first,
   so 1.0 freezes the contract and the output, not the source layout.
4. **1.1 (surface change, one ADR each):** `ArgSpec.secret`; report envelope;
   §4.6 render split (if not done before 1.0); container v4.

ADRs worth writing before the work starts:

- **0012 — Report envelope and versioning** (§4.7).
- **0013 — Secret arguments and the secret channel** (§4.3).
- **0014 — Container v4, sender authenticity** (§4.8).
- **0015 — The audit ledger** (§4.4), if the entry shape changes.

---

## 8. Appendix: reproduction

Run against the built CLI (`npm run build`) with a throwaway home.

```bash
export GIMLET_HOME=$(mktemp -d) G=/path/to/packages/cli/bin/gimlet

# D1 — keygen writes the files, then rejects its own report
$G keygen label=probe dir=/tmp/probe/keys; echo "exit=$?"
$G tools show crypto.keygen | grep -n 'public_path\|secret_path'

# D4 — duplicate key last-wins; unknown argument ignored
$G sha256 text=hello text=bye --format json | jq -r .data.source   # → "bye"
$G passgen length=12 bogus=1 --format json | jq -r .status        # → "ok"

# D5 — usage error as internal error
$G tools list --category nope; echo "exit=$?"

# D9 — markdown table broken by a pipe (any finding whose target contains '|')

# D10 — one entry per file, against a 1 000-entry cap
$G batch privacy.metadata-scan ~/Pictures --format json >/dev/null
wc -l "$GIMLET_HOME/audit.jsonl"
```

Evidence paths: `packages/core/src/tools/keys.ts:96`,
`packages/core/src/paths.ts` (`keystorePath`), `packages/core/src/runtime.ts`
(`execute`, `record`), `packages/core/src/sidecar.ts` (`assertReport`),
`packages/core/src/report.ts` (`sealed`, `renderMarkdown`),
`apps/desktop/src/lib/format.ts` (`cliCommand`),
`apps/desktop/src/components/workbench.ts` (form input type),
`apps/desktop/electron/main.ts` (`webPreferences`),
`packages/engine/src/scrub/index.ts` (pack message).
