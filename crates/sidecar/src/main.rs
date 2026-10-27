//! The verified engine behind the TypeScript surfaces.
//!
//! Cryptography and metadata parsing stay in Rust: they carry the fuzz corpora,
//! the golden fixtures, and the second implementation that pins the container
//! format. The desktop app and the CLI spawn this binary and speak
//! line-delimited JSON over stdio — one request per line, one response per line.
//!
//! This is an internal protocol, not an extension point: a caller can run the
//! tools this build ships and list them, and nothing else. There is no discovery
//! of user-supplied executables and no code the engine did not compile.

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use gimlet_eye_core::{AppPaths, Args, CapabilitySet, Config, GimletEyeError, Registry, Report, ToolContext};
use serde::Deserialize;
use serde_json::{json, Value};

/// Bumped when a request or response field changes meaning, so a surface built
/// against an older engine refuses it instead of guessing.
const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    op: String,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    args: Option<Value>,
    #[serde(default)]
    dry_run: bool,
    #[serde(default)]
    home: Option<PathBuf>,
}

fn main() {
    let registry = match build_registry() {
        Ok(registry) => registry,
        Err(error) => {
            eprintln!("gimlet-sidecar: {error}");
            std::process::exit(1);
        }
    };

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("gimlet-sidecar: cannot read stdin: {error}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => handle(&registry, request),
            // A request that does not parse has no id to answer, so the only
            // honest reply is an error at id 0: the caller sees a failure and
            // does not wait forever for the line it was expecting.
            Err(error) => json!({
                "id": 0,
                "ok": false,
                "error": { "code": "invalid_args", "message": format!("malformed request: {error}") },
            }),
        };

        if writeln!(stdout, "{response}").and_then(|()| stdout.flush()).is_err() {
            // The surface went away; nothing is left to answer.
            break;
        }
    }
}

fn build_registry() -> Result<Registry, GimletEyeError> {
    let mut registry = Registry::new();
    registry.register_all(gimlet_eye_crypto::tools()?)?;
    registry.register_all(gimlet_eye_scrub::tools()?)?;
    Ok(registry)
}

fn handle(registry: &Registry, request: Request) -> Value {
    match request.op.as_str() {
        "handshake" => json!({
            "id": request.id,
            "ok": true,
            "protocol_version": PROTOCOL_VERSION,
            "version": env!("CARGO_PKG_VERSION"),
        }),
        "list" => json!({
            "id": request.id,
            "ok": true,
            "tools": registry.manifests(),
        }),
        "run" => match run(registry, &request) {
            Ok(report) => json!({ "id": request.id, "ok": true, "report": report }),
            Err(error) => json!({
                "id": request.id,
                "ok": false,
                "error": { "code": error.code(), "message": error.to_string() },
            }),
        },
        other => json!({
            "id": request.id,
            "ok": false,
            "error": {
                "code": "unsupported",
                "message": format!("unknown operation '{other}' (this engine speaks {PROTOCOL_VERSION})"),
            },
        }),
    }
}

fn run(registry: &Registry, request: &Request) -> Result<Report, GimletEyeError> {
    let id = request
        .tool
        .as_deref()
        .ok_or_else(|| GimletEyeError::InvalidArgs("run needs a tool id".into()))?;
    // Surfaces resolve shorthands against the catalogue they were given; the
    // engine only runs an id it listed, so a typo fails here rather than
    // resolving to something the caller did not ask for.
    let tool = registry
        .get(id)
        .ok_or_else(|| GimletEyeError::NotFound(format!("tool '{id}'")))?;

    let args: Args = match request.args.clone() {
        None | Some(Value::Null) => Args::new(),
        Some(Value::Object(map)) => Args::from_map(map.into_iter().collect()),
        Some(_) => {
            return Err(GimletEyeError::InvalidArgs(
                "args must be an object of name → value".into(),
            ))
        }
    };

    let root = request
        .home
        .clone()
        .or_else(|| std::env::var_os("GIMLET_HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from(".gimlet"));
    let context = ToolContext::new(AppPaths::under(root))
        .with_config(Config::default())
        .with_dry_run(request.dry_run)
        .with_capabilities(CapabilitySet::all());

    let started = Instant::now();
    let mut report = tool.run(&context, &args)?;
    // The engine measures its own work, so a surface that adds process overhead
    // does not attribute it to the tool.
    if report.duration_ms == 0 {
        report = report.with_duration(started.elapsed());
    }
    Ok(report)
}
