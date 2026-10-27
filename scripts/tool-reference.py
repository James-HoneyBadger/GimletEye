#!/usr/bin/env python3
"""Generate docs/TOOL_REFERENCE.md: every tool, with an example and real output.

ADR 0006 Gate 5 asks that every tool have "an example with real output". Hand-
writing 39 examples guarantees two things: they will drift, and some will never
have been run. So they are run here, on this machine, and the output in the
document is what the tool actually printed.

The document is a snapshot, not a fixture: values like hostname and uptime belong
to the machine that ran it, and the header says so. What is enforced in CI is
coverage — `scripts/check-tool-reference.sh` fails when a tool exists that the
reference does not mention.

Usage: scripts/tool-reference.py [--binary PATH] [--out PATH] [--timeout SECONDS]
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import platform as host
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "crates/scrub/tests/golden/fixtures/photo-gps.jpg"
OUTPUT_LINES = 14

# One entry per tool: the arguments that produce a useful report. A tool with no
# entry is refused, so adding a tool means writing down how to show it.
EXAMPLES: dict[str, list[str]] = {
    "crypto.decrypt": ["input={container}", "passphrase_env=DEMO_PASSPHRASE", "output={work}/decrypted.jpg"],
    "crypto.encrypt": ["input={fixture}", "output={work}/example.gimlet", "passphrase_env=DEMO_PASSPHRASE"],
    "crypto.gpg-encrypt": ["input={fixture}", "recipient={gpg_recipient}", "output={work}/photo.gpg"],
    "crypto.gpg-verify": ["input={fixture}", "signature={gpg_signature}"],
    "crypto.inspect": ["input={container}"],
    "crypto.key-export": ["selector=demo", "output={work}/example.pub", "passphrase_env=DEMO_PASSPHRASE"],
    "crypto.key-import": [
        "key={work}/example.pub",
        "label=imported",
        "public_only=true",
        "passphrase_env=DEMO_PASSPHRASE",
    ],
    "crypto.key-list": ["passphrase_env=DEMO_PASSPHRASE"],
    "crypto.key-rotate": [
        "passphrase_env=DEMO_PASSPHRASE",
        "new_passphrase_env=DEMO_NEW_PASSPHRASE",
        "--dry-run",
    ],
    "crypto.keygen": ["label=example", "kind=ed25519", "keystore=true", "passphrase_env=DEMO_PASSPHRASE"],
    "crypto.passgen": ["length=24"],
    "crypto.sha256": ["path={fixture}"],
    "crypto.sign": ["input={fixture}", "key={work}/signing.key", "output={work}/example.sig"],
    "crypto.verify": ["input={fixture}", "signature={work}/setup.sig", "key={work}/demo.pub"],
    "privacy.metadata-scan": ["input={fixture}"],
    "privacy.metadata-strip": ["input={fixture}", "output={work}/stripped.jpg", "profile=privacy"],
    "privacy.metadata-verify": ["input={fixture}"],
    "sysadmin.disk-usage": ["path=/"],
    "sysadmin.kernel-hardening": [],
    "sysadmin.network": [],
    "sysadmin.system-info": [],
}

# Everything the pack provides takes no arguments, which is why it is listed
# rather than hand-written: the pack is the part most likely to grow.
for module in (
    "backup-manager",
    "bandwidth-monitor",
    "config-diff",
    "cron-manager",
    "disk-usage",
    "docker-monitor",
    "duplicate-finder",
    "failed-login-detector",
    "file-permissions",
    "firewall-auditor",
    "log-analyzer",
    "network-diag",
    "package-auditor",
    "port-scanner",
    "process-manager",
    "service-monitor",
    "ssl-checker",
    "system-info",
    "systemd-analyzer",
    "user-audit",
):
    EXAMPLES[f"perlden.{module}"] = []


def run(command: list[str], env: dict[str, str], timeout: int) -> tuple[int, str]:
    try:
        finished = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, env=env, check=False
        )
    except subprocess.TimeoutExpired:
        return -1, f"(timed out after {timeout}s)"
    output = (finished.stdout or "") + (finished.stderr or "")
    return finished.returncode, output.rstrip()


def strip_ansi(text: str) -> str:
    out = []
    index = 0
    while index < len(text):
        if text[index] == "\x1b" and index + 1 < len(text) and text[index + 1] == "[":
            index += 2
            while index < len(text) and not text[index].isalpha():
                index += 1
            index += 1
            continue
        out.append(text[index])
        index += 1
    return "".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default=None)
    parser.add_argument("--out", default=str(ROOT / "docs/TOOL_REFERENCE.md"))
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    binary = args.binary
    if binary is None:
        candidate = ROOT / "packages/cli/bin/gimlet"
        if candidate.exists():
            binary = str(candidate)
    if binary is None:
        sys.stderr.write("build the CLI first: npm run build\n")
        return 2

    work = pathlib.Path(tempfile.mkdtemp(prefix="gimlet-reference-"))
    home = work / "home"
    home.mkdir()
    gnupg = work / "gnupg"
    gnupg.mkdir(mode=0o700)

    env = {
        **os.environ,
        "GIMLET_HOME": str(home),
        "DEMO_PASSPHRASE": "reference-passphrase",
        "DEMO_NEW_PASSPHRASE": "reference-passphrase-rotated",
        "GNUPGHOME": str(gnupg),
        "NO_COLOR": "1",
    }

    catalogue = json.loads(
        subprocess.run(
            [binary, "tools", "list", "--json"],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        ).stdout
    )

    missing = [tool["id"] for tool in catalogue if tool["id"] not in EXAMPLES]
    if missing:
        sys.stderr.write("no example defined for: " + ", ".join(missing) + "\n")
        return 1

    # Setup: the artefacts some examples consume. Failures here are reported, not
    # hidden -- an example that could not be prepared must not look like one that
    # produced nothing.
    setup_log: dict[str, str] = {}

    def setup(name: str, command: list[str]) -> None:
        code, output = run(command, env, args.timeout)
        setup_log[name] = "ok" if code == 0 else strip_ansi(output)[-400:]

    setup(
        "keygen",
        [
            binary,
            "crypto.keygen",
            "label=demo",
            "kind=ed25519",
            "keystore=true",
            "passphrase_env=DEMO_PASSPHRASE",
        ],
    )
    setup(
        "export-secret",
        [
            binary,
            "crypto.key-export",
            "selector=demo",
            "secret=true",
            f"output={work}/signing.key",
            "passphrase_env=DEMO_PASSPHRASE",
        ],
    )
    setup(
        "export-public",
        [
            binary,
            "crypto.key-export",
            "selector=demo",
            f"output={work}/demo.pub",
            "passphrase_env=DEMO_PASSPHRASE",
        ],
    )
    setup(
        "encrypt",
        [
            binary,
            "crypto.encrypt",
            f"input={FIXTURE}",
            f"output={work}/photo.gimlet",
            "passphrase_env=DEMO_PASSPHRASE",
        ],
    )
    setup(
        "sign",
        [
            binary,
            "crypto.sign",
            f"input={FIXTURE}",
            f"key={work}/signing.key",
            f"output={work}/setup.sig",
        ],
    )
    setup(
        "gpg-key",
        [
            "gpg",
            "--batch",
            "--passphrase",
            "",
            "--quick-generate-key",
            "Reference Example <reference@example.invalid>",
            "default",
            "default",
            "never",
        ],
    )
    if setup_log["gpg-key"] == "ok":
        code, output = run(
            ["gpg", "--list-keys", "--with-colons"], env, args.timeout
        )
        fingerprint = ""
        for line in output.splitlines():
            if line.startswith("fpr:"):
                fingerprint = line.split(":")[9]
                break
        setup_log["gpg-recipient"] = "ok" if fingerprint else "no fingerprint found"
    else:
        fingerprint = ""
    setup(
        "gpg-signature",
        ["gpg", "--batch", "--yes", "--detach-sign", "-o", str(work / "photo.gpg.sig"), str(FIXTURE)]
        if setup_log["gpg-key"] == "ok"
        else ["false"],
    )

    placeholders = {
        "fixture": str(FIXTURE),
        "work": str(work),
        "home": str(home),
        "container": str(work / "photo.gimlet"),
        "gpg_recipient": fingerprint,
        "gpg_signature": str(work / "photo.gpg.sig"),
        "binary": binary,
    }

    lines: list[str] = []
    lines.append("# Tool reference")
    lines.append("")
    lines.append(
        "Every tool in the catalogue, with an example invocation and the output it "
        "produced. The examples are run by `scripts/tool-reference.py`, and the "
        "output below is a snapshot from one machine — hostname, uptime, and "
        "paths belong to whichever machine generated this file, so regenerate it "
        "before quoting a number."
    )
    lines.append("")
    lines.append(
        "`scripts/check-tool-reference.sh` fails when a tool exists that this file "
        "does not mention, so a new tool cannot ship undocumented."
    )
    lines.append("")
    version = subprocess.run(
        [binary, "--version"], capture_output=True, text=True, env=env, check=False
    ).stdout.strip()
    lines.append(
        f"Generated {datetime.date.today().isoformat()} on {host.system()} {host.machine()} "
        f"with `{version or 'an unversioned build'}`."
    )
    lines.append("")

    by_category: dict[str, list[dict]] = {}
    for tool in catalogue:
        by_category.setdefault(tool["category"], []).append(tool)

    failed: list[str] = []
    for category in sorted(by_category):
        lines.append(f"## {category.capitalize()}")
        lines.append("")
        for tool in sorted(by_category[category], key=lambda entry: entry["id"]):
            placement = EXAMPLES[tool["id"]]
            arguments = [argument.format(**placeholders) for argument in placement]
            shown = " ".join(["gimlet", tool["id"], *arguments])
            code, output = run([binary, tool["id"], *arguments], env, args.timeout)
            body = strip_ansi(output).strip().splitlines()
            keep = body[:OUTPUT_LINES]
            truncated = len(body) > OUTPUT_LINES

            badge = []
            if tool["mutates"]:
                badge.append("writes")
            # Where a tool runs is the interesting fact now: the crypto and
            # metadata tools go through the engine, the host tools do not.
            category = tool.get("category")
            badge.append("engine" if category in ("crypto", "privacy") else "native")

            lines.append(f"### `{tool['id']}`")
            lines.append("")
            lines.append(f"{tool['title']} — {tool['summary']}  ")
            lines.append(f"*{', '.join(badge)}*")
            lines.append("")
            lines.append("```console")
            lines.append(f"$ {shown}")
            lines.extend(keep if keep else ["(no output)"])
            if truncated:
                lines.append(f"… {len(body) - OUTPUT_LINES} more line(s)")
            lines.append("```")
            lines.append("")
            produced_report = len(body) > 1 and not body[0].startswith("gimlet: ")
            if code != 0 and not produced_report:
                failed.append(f"{tool['id']} (exit {code})")

    lines.append("## Examples that did not run here")
    lines.append("")
    notes = [f"- setup `{name}`: {state}" for name, state in setup_log.items() if state != "ok"]
    notes += [f"- `{tool}`" for tool in failed]
    if notes:
        lines.extend(notes)
    else:
        lines.append("None: every example above ran to completion on this host.")
    lines.append("")

    pathlib.Path(args.out).write_text("\n".join(lines) + "\n")
    shutil.rmtree(work, ignore_errors=True)

    print(
        f"wrote {args.out}: {len(catalogue)} tool(s), "
        f"{len(failed)} example(s) failed, "
        f"{len([n for n in notes if n.startswith('- setup')])} setup step(s) incomplete"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
