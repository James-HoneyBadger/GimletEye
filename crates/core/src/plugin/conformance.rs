//! The SDK conformance checklist, run instead of remembered.
//!
//! `docs/PLUGIN_SDK.md` §8 lists what a pack must do before it is published.
//! Half of that list is mechanical, and a checklist nobody executes decays into
//! folklore — so the mechanical half runs here and the rest is reported as
//! `manual` rather than quietly claimed as passing.
//!
//! Every check is read-only from the pack's point of view except starting it:
//! no tool is dispatched, because a conformance run must not rewrite the user's
//! files. "Is this tool id actually runnable" is therefore checked by asking for
//! an id that cannot exist and expecting the documented `-32001`.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::error::{GimletEyeError, Result};
use crate::plugin::host::{discover, RunningPack};
use crate::plugin::manifest::PackManifest;
use crate::plugin::protocol::codes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pass,
    Fail,
    /// Something only a human can judge; reported so the list stays honest.
    Manual,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Fail => "fail",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    /// Stable identifier, so a CI job can allow-list a manual step by name.
    pub id: String,
    pub title: String,
    pub outcome: Outcome,
    pub detail: String,
}

impl Check {
    fn new(id: &str, title: &str, outcome: Outcome, detail: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            title: title.to_string(),
            outcome,
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ConformanceReport {
    pub dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub checks: Vec<Check>,
}

impl ConformanceReport {
    pub fn passed(&self) -> usize {
        self.checks
            .iter()
            .filter(|check| check.outcome == Outcome::Pass)
            .count()
    }

    pub fn failed(&self) -> usize {
        self.checks
            .iter()
            .filter(|check| check.outcome == Outcome::Fail)
            .count()
    }

    pub fn manual(&self) -> usize {
        self.checks
            .iter()
            .filter(|check| check.outcome == Outcome::Manual)
            .count()
    }

    /// True when nothing failed. Manual items do not make a pack non-conformant;
    /// they make it un-inspected.
    pub fn is_conformant(&self) -> bool {
        self.failed() == 0
    }

    pub fn failures(&self) -> impl Iterator<Item = &Check> {
        self.checks
            .iter()
            .filter(|check| check.outcome == Outcome::Fail)
    }
}

/// Run the mechanical half of the SDK checklist against one pack directory.
pub fn check(dir: &Path, timeout: Duration) -> Result<ConformanceReport> {
    let mut report = ConformanceReport {
        dir: dir.display().to_string(),
        pack: None,
        version: None,
        checks: Vec::new(),
    };

    let path = crate::plugin::manifest::manifest_path(dir);
    let manifest = match PackManifest::load(&path) {
        Ok(manifest) => manifest,
        Err(error) => {
            report.checks.push(Check::new(
                "manifest-loads",
                "gimlet-pack.toml parses and speaks this host's protocol",
                Outcome::Fail,
                error.to_string(),
            ));
            return Ok(report);
        }
    };
    report.pack = Some(manifest.name.clone());
    report.version = Some(manifest.version.clone());
    // `PackManifest::load` already refuses a manifest whose protocol version
    // differs, so parsing and the protocol promise are one check, not two.
    report.checks.push(Check::new(
        "manifest-loads",
        "gimlet-pack.toml parses and speaks this host's protocol",
        Outcome::Pass,
        format!("{} {}, protocol 1", manifest.name, manifest.version),
    ));

    report.checks.push(Check::new(
        "manifest-enabled",
        "pack is enabled",
        if manifest.enabled {
            Outcome::Pass
        } else {
            Outcome::Fail
        },
        if manifest.enabled {
            "enabled = true"
        } else {
            "enabled = false: the host will never start this pack"
        },
    ));

    let mut pack = match RunningPack::start(dir, manifest.clone(), timeout) {
        Ok(pack) => {
            report.checks.push(Check::new(
                "process-starts",
                "process starts and speaks on stdout",
                Outcome::Pass,
                manifest
                    .program()
                    .map(|(program, args)| {
                        let mut line = program.to_string();
                        for arg in args {
                            line.push(' ');
                            line.push_str(arg);
                        }
                        line
                    })
                    .unwrap_or_else(|error| error.to_string()),
            ));
            pack
        }
        Err(error) => {
            report.checks.push(Check::new(
                "process-starts",
                "process starts and speaks on stdout",
                Outcome::Fail,
                error.to_string(),
            ));
            return Ok(report);
        }
    };

    match pack.handshake() {
        Ok(()) => report.checks.push(Check::new(
            "handshake",
            "initialize echoes the protocol version",
            Outcome::Pass,
            format!("{} tool(s) advertised", pack.tools.len()),
        )),
        Err(error) => {
            report.checks.push(Check::new(
                "handshake",
                "initialize echoes the protocol version",
                Outcome::Fail,
                error.to_string(),
            ));
            pack.shutdown();
            return Ok(report);
        }
    }

    report
        .checks
        .push(check_tool_ids(&pack.tools, &manifest.name));
    report
        .checks
        .push(check_capabilities(&pack.tools, &manifest.capabilities));
    report.checks.push(check_unknown_tool_rejected(&mut pack));

    report.checks.push(check_shutdown(&mut pack));
    report.checks.push(check_language_syntax(dir, &manifest));

    for (id, title) in [
        (
            "status-from-findings",
            "findings drive `status` (a `high` finding with `ok` is a bug)",
        ),
        (
            "dry-run-honoured",
            "`--dry-run` is honoured by anything that writes",
        ),
        ("no-secrets", "no secret values appear in any report field"),
    ] {
        report.checks.push(Check::new(
            id,
            title,
            Outcome::Manual,
            "judge this by reading a real report; no tool is run here",
        ));
    }

    Ok(report)
}

fn check_tool_ids(tools: &[crate::tool::ToolManifest], pack: &str) -> Check {
    let mut problems: Vec<String> = Vec::new();
    let mut seen: Vec<&str> = Vec::new();

    for tool in tools {
        if tool.id.trim().is_empty() {
            problems.push("a tool has an empty id".to_string());
            continue;
        }
        if !tool.id.contains('.') {
            problems.push(format!("'{}' is not namespaced (pack.tool)", tool.id));
        }
        if seen.contains(&tool.id.as_str()) {
            problems.push(format!("duplicate tool id '{}'", tool.id));
        }
        seen.push(&tool.id);

        if !tool.origin.is_empty() && tool.origin != format!("plugin:{pack}") {
            problems.push(format!(
                "'{}' declares origin '{}', expected 'plugin:{pack}'",
                tool.id, tool.origin
            ));
        }
    }

    if tools.is_empty() {
        problems.push("list_tools returned no tools".to_string());
    }

    if problems.is_empty() {
        Check::new(
            "tool-ids",
            "tool ids are namespaced, unique, and claimed by this pack",
            Outcome::Pass,
            format!("{} tool(s)", tools.len()),
        )
    } else {
        Check::new(
            "tool-ids",
            "tool ids are namespaced, unique, and claimed by this pack",
            Outcome::Fail,
            problems.join("; "),
        )
    }
}

fn check_capabilities(
    tools: &[crate::tool::ToolManifest],
    declared: &[crate::tool::Capability],
) -> Check {
    let mut widened: Vec<String> = Vec::new();
    for tool in tools {
        for capability in &tool.capabilities {
            if !declared.contains(capability) {
                widened.push(format!("{} needs {capability}", tool.id));
            }
        }
    }

    if widened.is_empty() {
        Check::new(
            "capability-subset",
            "every tool capability is declared in the manifest",
            Outcome::Pass,
            format!("{} declared", declared.len()),
        )
    } else {
        Check::new(
            "capability-subset",
            "every tool capability is declared in the manifest",
            Outcome::Fail,
            widened.join("; "),
        )
    }
}

fn check_unknown_tool_rejected(pack: &mut RunningPack) -> Check {
    let params = serde_json::json!({ "tool": "conformance.this.id.cannot.exist", "args": {} });
    match pack.request(crate::plugin::protocol::METHOD_RUN_TOOL, params) {
        Ok(_) => Check::new(
            "unknown-tool",
            "an unknown tool id is refused with -32001",
            Outcome::Fail,
            "the pack answered a request for a tool it never listed",
        ),
        Err(error) => {
            let text = error.to_string();
            let correct = text.contains(&codes::TOOL_NOT_FOUND.to_string());
            Check::new(
                "unknown-tool",
                "an unknown tool id is refused with -32001",
                if correct {
                    Outcome::Pass
                } else {
                    Outcome::Fail
                },
                text,
            )
        }
    }
}

fn check_shutdown(pack: &mut RunningPack) -> Check {
    // A pack that ignores `shutdown` leaves a process behind on every run, so
    // this asks for it explicitly and insists the child actually goes away.
    let title = "answers `shutdown` and exits";
    let answered = pack.request(
        crate::plugin::protocol::METHOD_SHUTDOWN,
        serde_json::Value::Null,
    );
    let exited = pack.wait_for_exit(Duration::from_secs(5));
    match (answered.is_ok(), exited) {
        (true, true) => Check::new("shutdown", title, Outcome::Pass, "replied and exited"),
        (false, true) => Check::new(
            "shutdown",
            title,
            Outcome::Pass,
            "exited on stdin close without replying (allowed)",
        ),
        (_, false) => Check::new(
            "shutdown",
            title,
            Outcome::Fail,
            "the process was still running five seconds after `shutdown`",
        ),
    }
}

fn check_language_syntax(dir: &Path, manifest: &PackManifest) -> Check {
    let title = "the pack's own language check passes";
    let Ok((program, args)) = manifest.program() else {
        return Check::new("language-syntax", title, Outcome::Fail, "no program");
    };
    let program_name = Path::new(&program)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();

    let (checker, checker_args): (&str, Vec<String>) = match program_name.as_str() {
        "perl" => ("perl", vec!["-c".into()]),
        "python" | "python3" => (
            "python3",
            vec![
                "-c".into(),
                "import sys,py_compile;py_compile.compile(sys.argv[1],doraise=True)".into(),
            ],
        ),
        "node" | "nodejs" | "bun" | "deno" => ("node", vec!["--check".into()]),
        other => {
            return Check::new(
                "language-syntax",
                title,
                Outcome::Manual,
                format!("no syntax checker known for '{other}'"),
            )
        }
    };

    let Some(script) = args.first() else {
        return Check::new(
            "language-syntax",
            title,
            Outcome::Manual,
            "no script argument",
        );
    };
    let path = dir.join(script);
    if !path.is_file() {
        return Check::new(
            "language-syntax",
            title,
            Outcome::Fail,
            format!("{} does not exist", path.display()),
        );
    }

    match std::process::Command::new(checker)
        .args(&checker_args)
        .arg(&path)
        .output()
    {
        Ok(output) if output.status.success() => Check::new(
            "language-syntax",
            title,
            Outcome::Pass,
            format!("{checker} {}", checker_args.join(" ")),
        ),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let first = stderr
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("checker failed");
            Check::new(
                "language-syntax",
                title,
                Outcome::Fail,
                first.trim().to_string(),
            )
        }
        Err(error) => Check::new(
            "language-syntax",
            title,
            Outcome::Manual,
            format!("{checker} is not installed: {error}"),
        ),
    }
}

/// Discover the pack in `dir` (or the first one below it) and check it.
pub fn check_first_below(dir: &Path, timeout: Duration) -> Result<ConformanceReport> {
    if crate::plugin::manifest::find_manifest(dir).is_some() {
        return check(dir, timeout);
    }
    let (found, failures) = discover(&[dir.to_path_buf()]);
    if let Some((pack_dir, _)) = found.first() {
        return check(pack_dir, timeout);
    }
    if let Some(failure) = failures.first() {
        return Err(GimletEyeError::Plugin(format!(
            "{}: {}",
            failure.manifest_path.display(),
            failure.error
        )));
    }
    Err(GimletEyeError::NotFound(format!(
        "no pack ({}) found under {}",
        crate::plugin::manifest::MANIFEST_FILENAMES.join(" or "),
        dir.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gimlet-conformance-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn manifest(dir: &Path, extra: &str) {
        fs::write(
            dir.join(crate::plugin::manifest::MANIFEST_FILENAME),
            format!(
                "name = \"probe\"\nversion = \"0.1.0\"\nprotocol_version = 1\n\
                 description = \"probe pack\"\ncommand = [\"python3\", \"pack.py\"]\n\
                 enabled = true\ncapabilities = [\"fs:read\"]\n{extra}"
            ),
        )
        .expect("manifest");
    }

    /// A pack whose behaviour is chosen by `mode`, so one script covers the
    /// passing case and each way of being broken.
    fn script(dir: &Path, mode: &str) {
        let code = format!(
            r#"#!/usr/bin/env python3
import json, sys

MODE = "{mode}"
TOOLS = [{{
    "id": "probe.tool", "title": "Probe", "summary": "probe",
    "category": "developer", "capabilities": ["fs:read"], "args": [],
    "origin": "plugin:probe",
}}]
if MODE == "unnamespaced":
    TOOLS = [dict(TOOLS[0], id="probe_tool")]
if MODE == "duplicate":
    TOOLS = [TOOLS[0], dict(TOOLS[0])]

for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    method = request.get("method")
    if method == "initialize":
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"],
                           "result": {{"protocol_version": 1, "name": "probe",
                                      "version": "0.1.0"}}}}), flush=True)
    elif method == "list_tools":
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"],
                           "result": {{"tools": TOOLS}}}}), flush=True)
    elif method == "run_tool":
        code = -32001 if MODE == "good" else -32003
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"],
                           "error": {{"code": code, "message": "no such tool"}}}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"], "result": {{}}}}), flush=True)
        break
"#
        );
        fs::write(dir.join("pack.py"), code).expect("script");
    }

    fn pack(name: &str, mode: &str) -> PathBuf {
        let dir = scratch(name);
        manifest(&dir, "");
        script(&dir, mode);
        dir
    }

    fn find<'a>(report: &'a ConformanceReport, id: &str) -> &'a Check {
        report
            .checks
            .iter()
            .find(|check| check.id == id)
            .unwrap_or_else(|| panic!("no check '{id}' in {:?}", report.checks))
    }

    #[test]
    fn a_conformant_pack_passes_every_mechanical_check() {
        let dir = pack("good", "good");
        let report = check(&dir, Duration::from_secs(10)).expect("check");

        assert_eq!(report.pack.as_deref(), Some("probe"));
        assert_eq!(report.failed(), 0, "{:?}", report.checks);
        assert_eq!(find(&report, "unknown-tool").outcome, Outcome::Pass);
        assert_eq!(find(&report, "tool-ids").outcome, Outcome::Pass);
        assert_eq!(find(&report, "shutdown").outcome, Outcome::Pass);
        assert_eq!(find(&report, "language-syntax").outcome, Outcome::Pass);
        // The human half is reported, not claimed.
        assert_eq!(report.manual(), 3);
        assert!(report.is_conformant());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pack_that_hides_the_unknown_tool_case_is_rejected() {
        let dir = pack("wrong-code", "wrong-code");
        let report = check(&dir, Duration::from_secs(10)).expect("check");

        let unknown = find(&report, "unknown-tool");
        assert_eq!(unknown.outcome, Outcome::Fail);
        assert!(unknown.detail.contains("-32003"), "{}", unknown.detail);
        assert!(!report.is_conformant());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pack_with_unusable_tool_ids_is_rejected() {
        for mode in ["unnamespaced", "duplicate"] {
            let dir = pack(mode, mode);
            let report = check(&dir, Duration::from_secs(10)).expect("check");
            let ids = find(&report, "tool-ids");
            assert_eq!(ids.outcome, Outcome::Fail, "{mode}: {:?}", ids);
            assert!(!report.is_conformant(), "{mode} should not be conformant");
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn a_manifest_that_promises_the_wrong_protocol_is_rejected() {
        let dir = scratch("protocol");
        manifest(&dir, "");
        let path = dir.join(crate::plugin::manifest::MANIFEST_FILENAME);
        let text = fs::read_to_string(&path)
            .expect("read")
            .replace("protocol_version = 1", "protocol_version = 99");
        fs::write(&path, text).expect("write");
        script(&dir, "good");

        let report = check(&dir, Duration::from_secs(10)).expect("check");
        let load = find(&report, "manifest-loads");
        assert_eq!(load.outcome, Outcome::Fail);
        assert!(
            load.detail.contains("protocol version 99"),
            "the failure must name the mismatch: {}",
            load.detail
        );
        assert!(!report.is_conformant());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_manifest_is_reported_rather_than_panicking() {
        let dir = scratch("no-manifest");
        fs::write(
            dir.join(crate::plugin::manifest::MANIFEST_FILENAME),
            "name = \"broken\"\nthis is not toml",
        )
        .expect("write");

        let report = check(&dir, Duration::from_secs(5)).expect("check");
        assert_eq!(find(&report, "manifest-loads").outcome, Outcome::Fail);
        assert_eq!(report.checks.len(), 1, "nothing else can be checked");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_without_a_pack_is_a_clear_error() {
        let dir = scratch("empty");
        let error = check_first_below(&dir, Duration::from_secs(5)).expect_err("no pack");
        assert_eq!(error.code(), "not_found");
        let _ = fs::remove_dir_all(&dir);
    }
}
