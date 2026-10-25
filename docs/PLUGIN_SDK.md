# Plugin SDK

A pack is **any executable** that speaks JSON-RPC 2.0 over stdin/stdout. Perl,
Python, Node, Go, a shell script — the host does not care.

The reference implementation is [`plugins/perlden-pack/pack.pl`](../plugins/perlden-pack/pack.pl),
an optional compatibility pack that exposes external system-audit modules.

---

## 1. Layout

```
my-pack/
├── mellivora-pack.toml     # required
├── pack.pl                 # the executable (any language)
└── README.md
```

## 2. Manifest

```toml
name = "my-pack"                 # unique; becomes the tool origin `plugin:my-pack`
version = "0.1.0"
protocol_version = 1             # must equal the host's version
description = "What this pack adds"
command = ["python3", "pack.py"] # argv — never a shell string
enabled = true
capabilities = ["fs:read", "process:exec"]
timeout_ms = 120000              # optional: worst case for slow tools

[env]                            # optional, passed to the child
MY_PACK_DATA = "/usr/share/my-pack"
```

`command` is split as argv and executed directly: manifests cannot inject shell
syntax. `capabilities` is a ceiling: the pack's tools may declare a subset of
these, never more (see [Capabilities](#6-capabilities)). The child's working
directory is the pack directory, and the host sets:

| Variable | Meaning |
|---|---|
| `MELLIVORA_PACK_DIR` | absolute path of the pack directory |
| `MELLIVORA_PROTOCOL_VERSION` | protocol version |

The host default timeout is 30 s (`plugins.timeout_ms`). A pack whose tools walk
a filesystem should raise it in its manifest rather than forcing every user to
edit config.

Relative paths in `command` resolve inside the pack directory.

## 3. Protocol

One JSON object per line. **stdout is the protocol channel; stderr is free-form
logging** and is inherited by the user's terminal.

### Handshake

Host → pack:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocol_version":1,"client":{"name":"mellivora","version":"0.1.0"}}}
```

Pack → host:

```json
{"jsonrpc":"2.0","id":1,
 "result":{"protocol_version":1,"name":"my-pack","version":"0.1.0","capabilities":["run","list_tools"]}}
```

If `protocol_version` differs, the host refuses the pack and reports it in
`mellivora plugins list` and `mellivora doctor` — other packs keep working.

### Tool listing

```json
{"jsonrpc":"2.0","id":2,"method":"list_tools"}
```

```json
{"jsonrpc":"2.0","id":2,"result":{"tools":[
  {"id":"mypack.greet","title":"Greet","summary":"Say hello",
   "category":"developer","capabilities":["fs:read"],
   "args":[{"name":"name","type":"string","required":true}],
   "tags":["demo"],"origin":"plugin:my-pack","version":"0.1.0",
   "mutates":false}
]}}
```

The `tools` array items are exactly the `ToolManifest` shape used everywhere
else. `category` is one of `sysadmin | crypto | privacy | forensics |
automation | developer`. `args[].type` is `string | integer | boolean | path |
enum` (for `enum`, add `"values": ["a","b"]`).

`mutates` (optional, default `false`) tells the surfaces whether the tool can
write to the host. Set it for anything that creates, rewrites, or deletes files:
the workbench then offers a dry run for that tool and marks it in the catalogue,
and `mellivora tools list` shows it in the `WRITES` column. Declaring it
truthfully is what lets a user point a pack at a directory without guessing.

### Execution

```json
{"jsonrpc":"2.0","id":3,"method":"run_tool",
 "params":{"tool":"mypack.greet","args":{"name":"Ada"}}}
```

```json
{"jsonrpc":"2.0","id":3,"result":{
  "tool":"mypack.greet","status":"ok","summary":"Hello, Ada",
  "findings":[],"data":{"greeting":"Hello, Ada"},
  "warnings":[],"duration_ms":1
}}
```

Optional report fields: `body` (human-facing text, preferred by text/Markdown
surfaces), `findings[]` with `{severity, code, message, target?}`, where
severity is `info | low | medium | high | critical`.

### Shutdown

```json
{"jsonrpc":"2.0","id":4,"method":"shutdown"}
```

The host also kills the process on drop. Respond to `shutdown` with any result
and exit 0.

### Errors

```json
{"jsonrpc":"2.0","id":3,"error":{"code":-32003,"message":"execution failed: ..."}}
```

Reserved application codes:

| Code | Meaning |
|---|---|
| `-32001` | tool not found |
| `-32002` | invalid arguments |
| `-32003` | execution failed |
| `-32004` | unsupported operation |

## 4. Report rules

1. **Always set `tool` to the id you were asked to run.**
2. **Derive `status` from findings**: `high`/`critical` → `error`,
   `medium`/`low` → `warning`, otherwise `ok`. The host displays `status` as-is;
   there is no second chance to correct it.
3. **`summary` is one line.** Put detail in `body` or `data`.
4. **Never put secrets in `summary`, `body`, `data`, or `warnings`.** Reports are
   rendered in the UI and stored in shell history.
5. **`duration_ms` is measured by the pack**; the host reports it verbatim.

## 5. Writing a pack

### Python (complete example)

```python
#!/usr/bin/env python3
import json, sys, time

TOOLS = [{
    "id": "mypack.greet",
    "title": "Greet",
    "summary": "Say hello",
    "category": "developer",
    "capabilities": [],
    "args": [{"name": "name", "type": "string", "required": True}],
    "origin": "plugin:my-pack",
    "version": "0.1.0",
}]

def reply(id_, result):
    print(json.dumps({"jsonrpc": "2.0", "id": id_, "result": result}), flush=True)

def fail(id_, code, message):
    print(json.dumps({"jsonrpc": "2.0", "id": id_,
                      "error": {"code": code, "message": message}}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    id_, method, params = request.get("id"), request.get("method"), request.get("params") or {}

    if method == "initialize":
        reply(id_, {"protocol_version": 1, "name": "my-pack",
                    "version": "0.1.0", "capabilities": ["run", "list_tools"]})
    elif method == "list_tools":
        reply(id_, {"tools": TOOLS})
    elif method == "run_tool":
        started = time.time()
        name = params.get("args", {}).get("name")
        if not name:
            fail(id_, -32002, "missing argument 'name'")
            continue
        reply(id_, {
            "tool": params.get("tool", "mypack.greet"),
            "status": "ok",
            "summary": f"Hello, {name}",
            "findings": [],
            "data": {"greeting": f"Hello, {name}"},
            "warnings": [],
            "duration_ms": int((time.time() - started) * 1000),
        })
    elif method == "shutdown":
        reply(id_, {})
        break
    else:
        fail(id_, -32601, f"unknown method '{method}'")
```

### Node / TypeScript

Same loop with `readline` over `process.stdin`; write with `process.stdout.write(JSON.stringify(msg) + "\n")`.

### Rust

Anything that produces lines on stdout works. If the pack needs the toolkit's
types, depend on `mellivora-core` and `serde_json::to_string(&report)`. See
`RunningPack::request` in [`crates/core/src/plugin/host.rs`](../crates/core/src/plugin/host.rs)
for the exact request shapes.

### Language gotchas

- **Flush stdout after every response.** Buffered output looks like a hung pack.
- **Keep stdout clean.** A stray `print` breaks framing. Log to stderr.
- **Encoding:** emit UTF-8. In Perl, either `use utf8` in your own source, or
  normalize text from legacy modules — see `normalize_text` in the Perl pack.
- **Long-running tools** must respect the host timeout (`plugins.timeout_ms`,
  30 s by default). A pack may declare its own `timeout_ms` in
  `mellivora-pack.toml` when its tools legitimately walk a filesystem.

## 6. Capabilities

Packs declare `capabilities` in the manifest, and the manifest is the contract:
a tool may use a subset of what the pack declared, never more. A pack whose
`list_tools` response asks for a capability the manifest omits fails to load
rather than being dispatched. The host refuses to dispatch any tool from a pack
whose declared capabilities are not granted:

```toml
[plugins]
allow = ["fs:read", "system"]     # empty list = grant whatever packs declare
```

Use the narrowest set. A pack that only parses files should not request
`process:exec`.

Built-in capabilities: `fs:read`, `fs:write`, `process:exec`, `network`,
`secrets`, `system`.

## 7. Discovery and debugging

Packs are discovered up to three levels deep in:

1. directories in `plugins.dirs` (config),
2. `$MELLIVORA_HOME/plugins`,
3. `./plugins` (relative to the working directory, for development),
4. `$MELLIVORA_PLUGIN_PATH` (colon-separated).

```bash
mellivora plugins list       # loaded packs, tool counts, failures
mellivora plugins doctor     # start each pack and list its tools
mellivora doctor             # installation checks, including pack failures
mellivora -v run mypack.greet name=Ada   # debug logging to stderr
```

A broken pack never prevents startup: it is recorded as a failure with the
manifest path and the underlying error.

## 8. Conformance checklist

Before publishing a pack:

- [ ] `initialize` returns the same `protocol_version` it received.
- [ ] `list_tools` ids are stable, namespaced (`pack.tool`), and unique.
- [ ] Every capability a tool lists is also declared in `mellivora-pack.toml` —
      a tool that widens the manifest is refused at load time.
- [ ] Every manifest id is actually runnable.
- [ ] Findings drive `status` (a `high` finding with `ok` status is a bug).
- [ ] `--dry-run` is honoured for anything that writes.
- [ ] No secret values appear in any report field.
- [ ] Pack exits cleanly on `shutdown` and on stdin EOF.
- [ ] Pack works when `cwd` is its own directory.
- [ ] `perl -c` / `tsc` / `python -m py_compile` passes in CI.
