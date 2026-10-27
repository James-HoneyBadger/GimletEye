#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The desktop shell.
//!
//! All of the logic — the tool catalogue, the report contract, configuration,
//! the audit trail — lives in TypeScript (`packages/core`), shared with the CLI.
//! This crate owns exactly two things: the window, and the operating-system
//! boundary the webview cannot reach on its own (files, processes, and the
//! lifetime of the verified crypto engine).
//!
//! The engine is `gimlet-sidecar`, bundled next to this executable. It is
//! spawned once, and requests are serialised through one mutex: a tool run is a
//! single conversation, and two concurrent runs through one pipe would find each
//! other's replies.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

/// What the frontend is told when an operating-system call fails.
#[derive(Debug, Serialize)]
pub struct HostError {
    code: &'static str,
    message: String,
}

impl From<std::io::Error> for HostError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            _ => "io",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl HostError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    platform: &'static str,
    arch: &'static str,
    home: String,
    config_dir: String,
    tmp_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStat {
    is_file: bool,
    is_directory: bool,
    size: u64,
}

#[derive(Debug, Serialize)]
pub struct ExecResult {
    code: i32,
    stdout: String,
    stderr: String,
}

struct EngineProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl EngineProcess {
    fn start() -> Result<Self, HostError> {
        let binary = engine_binary()?;
        let mut child = Command::new(&binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| {
                HostError::new(
                    "not_found",
                    format!(
                        "cannot start the engine at {}: {error}. Build it with `cargo build -p gimlet-eye-sidecar`.",
                        binary.display()
                    ),
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| HostError::new("internal", "the engine has no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| HostError::new("internal", "the engine has no stdout"))?;

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn request(&mut self, payload: &serde_json::Value) -> Result<serde_json::Value, HostError> {
        let line = serde_json::to_string(payload)
            .map_err(|error| HostError::new("internal", error.to_string()))?;
        writeln!(self.stdin, "{line}").map_err(HostError::from)?;
        self.stdin.flush().map_err(HostError::from)?;

        let mut reply = String::new();
        let read = self.stdout.read_line(&mut reply).map_err(HostError::from)?;
        if read == 0 {
            let status = self.child.try_wait().ok().flatten();
            return Err(HostError::new(
                "tool",
                match status {
                    Some(status) => format!("the engine exited ({status})"),
                    None => "the engine closed its output".to_string(),
                },
            ));
        }
        serde_json::from_str(&reply).map_err(|error| HostError::new("tool", error.to_string()))
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct Engine(Mutex<Option<EngineProcess>>);

/// `GIMLET_SIDECAR`, then next to this executable, then the build tree.
fn engine_binary() -> Result<PathBuf, HostError> {
    if let Some(path) = std::env::var_os("GIMLET_SIDECAR") {
        return Ok(PathBuf::from(path));
    }

    let name = if cfg!(windows) {
        "gimlet-sidecar.exe"
    } else {
        "gimlet-sidecar"
    };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let beside = dir.join(name);
            if beside.is_file() {
                return Ok(beside);
            }
        }
    }

    // A development build run from the checkout: `target/{release,debug}`.
    for relative in ["target/release", "target/debug"] {
        let candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join(relative)
            .join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(HostError::new(
        "not_found",
        format!("engine not found: install {name} next to this app, or set GIMLET_SIDECAR"),
    ))
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn home() -> Result<PathBuf, HostError> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| HostError::new("config", "neither HOME nor USERPROFILE is set"))
}

fn config_dir() -> Result<PathBuf, HostError> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| HostError::new("config", "APPDATA is not set"))?
    } else if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support")
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or(home()?.join(".config"))
    };
    Ok(base)
}

fn as_string(path: &Path) -> Result<String, HostError> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| HostError::new("io", format!("path is not valid UTF-8: {path:?}")))
}

#[tauri::command]
fn host_info() -> Result<HostInfo, HostError> {
    Ok(HostInfo {
        platform: platform(),
        arch: std::env::consts::ARCH,
        home: as_string(&home()?)?,
        config_dir: as_string(&config_dir()?)?,
        tmp_dir: as_string(&std::env::temp_dir())?,
    })
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, HostError> {
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, HostError> {
    Ok(std::fs::read(path)?)
}

#[tauri::command]
fn write_text_file(path: String, text: String) -> Result<(), HostError> {
    Ok(std::fs::write(path, text)?)
}

#[tauri::command]
fn write_file(path: String, bytes: Vec<u8>) -> Result<(), HostError> {
    Ok(std::fs::write(path, bytes)?)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), HostError> {
    Ok(std::fs::create_dir_all(path)?)
}

#[tauri::command]
fn remove_tree(path: String) -> Result<(), HostError> {
    match std::fs::remove_dir_all(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(inner) if inner.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(HostError::from(error)),
        },
    }
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn path_stat(path: String) -> Result<PathStat, HostError> {
    let info = std::fs::metadata(path)?;
    Ok(PathStat {
        is_file: info.is_file(),
        is_directory: info.is_dir(),
        size: info.len(),
    })
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<String>, HostError> {
    let mut names = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_owned());
        }
    }
    Ok(names)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), HostError> {
    Ok(std::fs::rename(from, to)?)
}

#[tauri::command]
fn chmod_owner_only(path: String) -> Result<(), HostError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[tauri::command]
fn resolve_path(path: String) -> Result<String, HostError> {
    Ok(as_string(&std::fs::canonicalize(path)?)?)
}

#[tauri::command]
fn exec_command(program: String, args: Vec<String>) -> Result<ExecResult, HostError> {
    let output = match Command::new(&program).args(&args).output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ExecResult {
                code: 127,
                stdout: String::new(),
                stderr: format!("{program}: not found"),
            })
        }
        Err(error) => return Err(HostError::from(error)),
    };
    Ok(ExecResult {
        code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[tauri::command]
fn engine_request(
    engine: tauri::State<'_, Engine>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, HostError> {
    let mut guard = engine
        .0
        .lock()
        .map_err(|_| HostError::new("internal", "the engine lock is poisoned"))?;
    if guard.is_none() {
        *guard = Some(EngineProcess::start()?);
    }
    let process = guard
        .as_mut()
        .ok_or_else(|| HostError::new("internal", "the engine is not running"))?;
    process.request(&payload)
}

fn main() {
    tauri::Builder::default()
        .manage(Engine::default())
        .invoke_handler(tauri::generate_handler![
            host_info,
            read_text_file,
            read_file,
            write_text_file,
            write_file,
            create_dir,
            remove_tree,
            path_exists,
            path_stat,
            read_dir,
            rename_path,
            chmod_owner_only,
            resolve_path,
            exec_command,
            engine_request
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the Gimlet Eye desktop shell");
}
