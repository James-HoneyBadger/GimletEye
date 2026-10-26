# Pack gallery

A pack is an adapter for a capability another program already provides. This is
one written from an empty directory, start to finish, with the parts that are
easy to get wrong called out.

The finished article is [`examples/packs/hostname/`](../examples/packs/hostname),
and it passes `mellivora plugins conformance` — the same checklist that rejects a
deliberately broken pack in CI.

## 1. An empty directory and a manifest

```bash
mkdir -p ~/packs/hostname && cd ~/packs/hostname
```

```toml
# mellivora-pack.toml
name = "hostname"
version = "1.0.0"
protocol_version = 1
description = "The reference pack: two tools, no dependencies"
command = ["python3", "pack.py"]
enabled = true
capabilities = ["system"]
timeout_ms = 10000
```

Two things here decide whether the pack loads at all:

- **`protocol_version` must equal the host's.** A mismatch is refused and
  reported, and every other pack keeps working.
- **`capabilities` is a ceiling.** Every tool may ask for a subset of this list
  and never more; a tool that widens it is refused at load time, not at call
  time.

## 2. The loop

One JSON object per line on stdin, one per line on stdout. stderr is yours for
logging, and **stdout must stay clean** — a stray `print` breaks framing and the
pack looks hung.

```python
import json, sys

for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    method = request.get("method")
    request_id = request.get("id")

    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": {
            "protocol_version": 1, "name": "hostname", "version": "1.0.0",
            "capabilities": ["run", "list_tools"]}}), flush=True)
    elif method == "list_tools":
        print(json.dumps({"jsonrpc": "2.0", "id": request_id,
                          "result": {"tools": TOOLS}}), flush=True)
    elif method == "run_tool":
        ...
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": {}}), flush=True)
        break
```

Three details that cause most of the bugs:

1. **Flush after every line**, or the host waits for output that is sitting in a
   buffer.
2. **Echo the `id`** you were given. A reply with a different id is ignored, and
   a notification (a line with no id) is skipped rather than mistaken for the
   answer in flight.
3. **Exit on `shutdown`**, and on stdin EOF.

## 3. A read-only tool

```json
{
  "id": "hostname.report",
  "title": "Report the hostname",
  "summary": "Read the machine's hostname and flag a generic cloud default",
  "category": "sysadmin",
  "capabilities": ["system"],
  "args": [],
  "tags": ["identity", "system"],
  "origin": "plugin:hostname",
  "version": "1.0.0",
  "mutates": false
}
```

The reply:

```json
{
  "tool": "hostname.report",
  "status": "warning",
  "summary": "hostname: ip-10-0-0-4",
  "findings": [
    {"severity": "low", "code": "generic-hostname", "message": "'ip-10-0-0-4' looks like a default"}
  ],
  "data": {"hostname": "ip-10-0-0-4", "length": 12},
  "warnings": [],
  "duration_ms": 0
}
```

`status` is **derived from the findings**, never chosen freely: a `low` or
`medium` finding means `warning`, a `high` or `critical` one means `error`. A
`high` finding with `"status": "ok"` is a bug, and no surface can fix it for you.

`data` follows the same convention as every native tool: an object (or an array
of objects) with `snake_case` keys, at most two levels deep, values that are
values rather than prose. Prose belongs in `body`.

## 4. A tool that writes

```json
{
  "id": "hostname.set",
  "title": "Set the hostname",
  "summary": "Change the hostname, showing what would happen under --dry-run",
  "category": "sysadmin",
  "capabilities": ["system"],
  "args": [{"name": "name", "type": "string", "required": True}],
  "origin": "plugin:hostname",
  "version": "1.0.0",
  "mutates": true
}
```

`mutates: true` is what makes the workbench offer a dry run and what puts the
`writes` flag in `tools list`. Declaring it truthfully is the whole point: it is
what lets someone point a pack at a directory without guessing.

The host then sends `dry_run` beside the arguments:

```json
{"jsonrpc":"2.0","id":4,"method":"run_tool",
 "params":{"tool":"hostname.set","args":{"name":"web-01"},"dry_run":true}}
```

Honour it. It is not one of your arguments and does not need declaring; it is the
user saying "show me, do not touch anything".

## 5. Errors

Use the documented codes, because a caller acts on them differently:

| Code | Meaning |
|---|---|
| `-32001` | no such tool — the caller has a stale id |
| `-32002` | invalid arguments — the caller can fix it |
| `-32003` | the tool failed while running |
| `-32004` | unsupported operation |

Answering `-32003` for an unknown tool sends the caller looking at its own
arguments. The reference pack in this repository did exactly that until
`mellivora plugins conformance` caught it.

## 6. Check it before publishing

```bash
mellivora plugins conformance ~/packs/hostname
```

```text
  pass    mellivora-pack.toml parses and speaks this host's protocol
  pass    pack is enabled
  pass    process starts and speaks on stdout
  pass    initialize echoes the protocol version
  pass    tool ids are namespaced, unique, and claimed by this pack
  pass    every tool capability is declared in the manifest
  pass    an unknown tool id is refused with -32001
  pass    answers `shutdown` and exits
  pass    the pack's own language check passes
  manual  findings drive `status` (a `high` finding with `ok` is a bug)
  manual  `--dry-run` is honoured for anything that writes
  manual  no secret values appear in any report field

9 passed, 0 failed, 3 manual
```

The three `manual` lines are the ones a runner cannot judge. Read a real report
for each before you call the pack finished.

To install it, copy the directory under `$MELLIVORA_HOME/plugins/` (or point
`[plugins] dirs` at it) and run `mellivora plugins list`. To pin it — which you
should for anything you did not write — run `mellivora plugins pin
~/packs/hostname` and paste the digest into `[trust]`.
