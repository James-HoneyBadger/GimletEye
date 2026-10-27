//! The engine protocol, driven through the real binary.
//!
//! The protocol is the boundary both surfaces cross, so it is tested the way a
//! surface uses it: spawn the binary, write a line, read the line back.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

struct Engine {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Engine {
    fn start(home: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_gimlet-sidecar"))
            .env("GIMLET_HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn engine");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn send(&mut self, payload: Value) -> Value {
        writeln!(self.stdin, "{payload}").expect("write");
        self.stdin.flush().expect("flush");
        self.read_line()
    }

    fn read_line(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("read");
        serde_json::from_str(&line).expect("json")
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gimlet-sidecar-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

#[test]
fn handshake_reports_the_protocol_this_build_speaks() {
    let home = home("handshake");
    let mut engine = Engine::start(&home);

    let reply = engine.send(json!({ "id": 1, "op": "handshake" }));
    assert_eq!(reply["id"], 1);
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["protocol_version"], 1);
    assert_eq!(reply["version"], env!("CARGO_PKG_VERSION"));

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn list_reports_the_catalogue_the_surfaces_show() {
    let home = home("list");
    let mut engine = Engine::start(&home);

    let reply = engine.send(json!({ "id": 2, "op": "list" }));
    let tools = reply["tools"].as_array().expect("tools");
    let ids: Vec<&str> = tools
        .iter()
        .map(|tool| tool["id"].as_str().expect("id"))
        .collect();

    // One from each domain the engine owns, and no host tools: those live in
    // TypeScript and must not be duplicated here.
    assert!(ids.contains(&"crypto.sha256"), "{ids:?}");
    assert!(ids.contains(&"privacy.metadata-scan"), "{ids:?}");
    assert!(!ids.contains(&"sysadmin.system-info"), "{ids:?}");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn run_returns_a_report_with_the_documented_shape() {
    let home = home("run");
    let mut engine = Engine::start(&home);

    let reply = engine.send(json!({
        "id": 3,
        "op": "run",
        "tool": "crypto.sha256",
        "args": { "text": "hello" },
    }));
    assert_eq!(reply["ok"], true, "{reply}");
    let report = &reply["report"];
    assert_eq!(report["tool"], "crypto.sha256");
    assert_eq!(report["status"], "ok");
    assert_eq!(
        report["data"]["sha256"],
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn a_bad_argument_comes_back_as_a_code_the_surface_can_branch_on() {
    let home = home("bad-args");
    let mut engine = Engine::start(&home);

    let reply = engine.send(json!({
        "id": 4,
        "op": "run",
        "tool": "crypto.passgen",
        "args": { "length": "not-a-number" },
    }));
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["error"]["code"], "invalid_args");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn an_unknown_tool_is_refused_rather_than_guessed() {
    let home = home("unknown");
    let mut engine = Engine::start(&home);

    let reply = engine.send(json!({ "id": 5, "op": "run", "tool": "crypto.nope" }));
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["error"]["code"], "not_found");

    // A shorthand a surface would resolve is *not* resolved here.
    let reply =
        engine.send(json!({ "id": 6, "op": "run", "tool": "sha256", "args": { "text": "x" } }));
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["error"]["code"], "not_found");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn an_unknown_operation_is_refused_rather_than_ignored() {
    let home = home("unknown-op");
    let mut engine = Engine::start(&home);

    let reply = engine.send(json!({ "id": 7, "op": "install-a-pack" }));
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["error"]["code"], "unsupported");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn a_malformed_line_is_answered_at_id_zero() {
    let home = home("malformed");
    let mut engine = Engine::start(&home);

    writeln!(engine.stdin, "this is not json").expect("write");
    engine.stdin.flush().expect("flush");
    let reply = engine.read_line();

    assert_eq!(reply["id"], 0);
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["error"]["code"], "invalid_args");

    // The engine keeps serving after a bad line.
    let reply = engine.send(json!({ "id": 8, "op": "handshake" }));
    assert_eq!(reply["ok"], true);

    let _ = std::fs::remove_dir_all(&home);
}
