#!/usr/bin/env python3
"""The reference pack: the whole protocol in one file, no dependencies.

Read docs/PLUGIN_SDK.md beside this; every rule it states appears here once.

  mellivora plugins conformance examples/packs/hostname   # should be all green

Two tools, deliberately different shapes:

  * `hostname.report` returns structured data and a finding when the name
    looks like the default a cloud image assigns, which is how a pack says
    "something is wrong" without printing anything.
  * `hostname.set` writes, so it honours `--dry-run` - the host passes that
    down as `dry_run` in the arguments.
"""

import json
import socket
import sys

PACK = "hostname"

TOOLS = [
    {
        "id": "hostname.report",
        "title": "Report the hostname",
        "summary": "Read the machine's hostname and flag a generic cloud default",
        "category": "sysadmin",
        "capabilities": ["system"],
        "args": [],
        "tags": ["identity", "system"],
        "origin": f"plugin:{PACK}",
        "version": "1.0.0",
        "mutates": False,
    },
    {
        "id": "hostname.set",
        "title": "Set the hostname",
        "summary": "Change the hostname, showing what would happen under --dry-run",
        "category": "sysadmin",
        # The manifest declares ["system"], so this tool may not ask for more:
        # a tool that widens its pack's manifest is refused at load time.
        "capabilities": ["system"],
        "args": [
            {
                "name": "name",
                "type": "string",
                "required": True,
                "help": "New hostname (letters, digits, and dashes)",
            },
        ],
        "tags": ["identity", "system", "writes"],
        "origin": f"plugin:{PACK}",
        "version": "1.0.0",
        "mutates": True,
    },
]

# Cloud images hand out names like `ip-10-0-0-4` or `localhost`. Reporting one is
# not an error, but it is worth a finding: half the point of an inventory tool is
# noticing the default.
GENERIC = ("localhost", "localhost.localdomain")


def reply(request_id, result):
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}), flush=True)


def fail(request_id, code, message):
    print(
        json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
        ),
        flush=True,
    )


def current_hostname():
    return socket.gethostname()


def run_report(_args):
    """The read-only tool: data plus findings, never prose."""
    name = current_hostname()
    findings = []
    if name in GENERIC or name.startswith("ip-"):
        findings.append(
            {
                "severity": "low",
                "code": "generic-hostname",
                "message": f"'{name}' looks like a default; it is not an identity",
            }
        )

    # `status` is derived from the findings, never chosen freely: a `low` finding
    # makes this a warning, so the two cannot disagree.
    status = "warning" if findings else "ok"
    return {
        "tool": "hostname.report",
        "status": status,
        "summary": f"hostname: {name}",
        "findings": findings,
        "data": {"hostname": name, "length": len(name)},
        "warnings": [],
        "duration_ms": 0,
    }


def run_set(args, dry_run):
    """The mutating tool: it has to honour dry_run.

    `dry_run` comes from the host beside the arguments, not from them: it is a
    flag the user passed, not something a tool declares.
    """
    name = args.get("name")
    if not name:
        return None, -32002, "missing argument 'name'"
    if any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in name.lower()):
        return None, -32002, "a hostname may contain letters, digits, and dashes only"

    if dry_run:
        return {
            "tool": "hostname.set",
            "status": "ok",
            "summary": f"would set the hostname to {name}",
            "findings": [],
            "data": {"current": current_hostname(), "requested": name, "dry_run": True},
            "warnings": [],
            "duration_ms": 0,
        }, None, None

    # Doing it for real needs root; a pack that cannot do the work says so with
    # the documented execution-failure code rather than pretending it worked.
    if current_hostname() != name:
        return None, -32003, (
            "changing the hostname needs root and is not attempted by this example; "
            "run with dry_run=true to see the intended change"
        )

    return {
        "tool": "hostname.set",
        "status": "ok",
        "summary": f"hostname is already {name}",
        "findings": [],
        "data": {"current": name, "requested": name, "dry_run": False},
        "warnings": [],
        "duration_ms": 0,
    }, None, None


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params") or {}

        if method == "initialize":
            reply(
                request_id,
                {
                    "protocol_version": 1,
                    "name": PACK,
                    "version": "1.0.0",
                    "capabilities": ["run", "list_tools"],
                },
            )
        elif method == "list_tools":
            reply(request_id, {"tools": TOOLS})
        elif method == "run_tool":
            tool = params.get("tool")
            args = params.get("args") or {}
            if tool == "hostname.report":
                reply(request_id, run_report(args))
            elif tool == "hostname.set":
                result, code, message = run_set(args, bool(params.get("dry_run")))
                if result is None:
                    fail(request_id, code, message)
                else:
                    reply(request_id, result)
            else:
                fail(request_id, -32001, f"unknown tool '{tool}'")
        elif method == "shutdown":
            reply(request_id, {})
            break
        else:
            fail(request_id, -32601, f"unknown method '{method}'")


if __name__ == "__main__":
    main()
