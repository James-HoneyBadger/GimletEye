use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{MellivoraError, Result};
use crate::plugin::manifest::{manifest_dirs, PackManifest, MANIFEST_FILENAME};
use crate::plugin::protocol::{
    ClientInfo, InitializeResult, ListToolsResult, Request, Response, METHOD_INITIALIZE,
    METHOD_LIST_TOOLS, METHOD_RUN_TOOL, METHOD_SHUTDOWN, PROTOCOL_VERSION,
};
use crate::report::Report;
use crate::tool::{Args, Capability, Tool, ToolContext, ToolManifest};

/// A pack that failed to load, retained so `mellivora doctor` can explain why.
#[derive(Debug, Clone, Serialize)]
pub struct PackFailure {
    pub manifest_path: PathBuf,
    pub error: String,
}

/// Loaded pack metadata for listings.
#[derive(Debug, Clone, Serialize)]
pub struct PackSummary {
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub dir: PathBuf,
    pub tool_count: usize,
    pub capabilities: Vec<Capability>,
}

/// A live pack process speaking the JSON-RPC protocol.
pub struct RunningPack {
    pub manifest: PackManifest,
    pub dir: PathBuf,
    pub tools: Vec<ToolManifest>,
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<String>,
    next_id: u64,
    timeout: Duration,
}

impl std::fmt::Debug for RunningPack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunningPack")
            .field("name", &self.manifest.name)
            .field("dir", &self.dir)
            .field("tools", &self.tools.len())
            .finish()
    }
}

impl RunningPack {
    pub fn start(dir: &Path, manifest: PackManifest, timeout: Duration) -> Result<Self> {
        // Canonicalise so packs that walk up from their directory (to find the
        // toolkit root or a sibling checkout) get an absolute path.
        let dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        let (program, args) = manifest.program()?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .env("MELLIVORA_PROTOCOL_VERSION", PROTOCOL_VERSION.to_string())
            .env("MELLIVORA_PACK_DIR", &dir);
        for (key, value) in &manifest.env {
            command.env(key, value);
        }

        let mut child = command.spawn().map_err(|err| {
            MellivoraError::Plugin(format!(
                "failed to start pack '{}' ({}): {err}",
                manifest.name, program
            ))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            MellivoraError::Plugin(format!("pack '{}' has no stdout", manifest.name))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            MellivoraError::Plugin(format!("pack '{}' has no stdin", manifest.name))
        })?;

        let (sender, responses) = mpsc::channel();
        std::thread::Builder::new()
            .name(format!("mellivora-pack-{}", manifest.name))
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    if sender.send(line).is_err() {
                        break;
                    }
                }
            })?;

        Ok(Self {
            manifest,
            dir,
            tools: Vec::new(),
            child,
            stdin,
            responses,
            next_id: 0,
            timeout,
        })
    }

    /// Negotiate the protocol and pull the pack's tool catalogue.
    pub fn handshake(&mut self) -> Result<()> {
        let params = json!({
            "protocol_version": PROTOCOL_VERSION,
            "client": ClientInfo { name: "mellivora".into(), version: crate::VERSION.into() },
        });
        let result = self.request(METHOD_INITIALIZE, params)?;
        let init: InitializeResult = serde_json::from_value(result).map_err(|err| {
            MellivoraError::Plugin(format!(
                "pack '{}' returned an invalid initialize result: {err}",
                self.manifest.name
            ))
        })?;
        if init.protocol_version != PROTOCOL_VERSION {
            return Err(MellivoraError::Plugin(format!(
                "pack '{}' negotiated protocol {}, host speaks {PROTOCOL_VERSION}",
                self.manifest.name, init.protocol_version
            )));
        }

        let listed = self.request(METHOD_LIST_TOOLS, Value::Null)?;
        let mut tools: ListToolsResult = serde_json::from_value(listed).map_err(|err| {
            MellivoraError::Plugin(format!(
                "pack '{}' returned an invalid tool list: {err}",
                self.manifest.name
            ))
        })?;

        let origin = format!("plugin:{}", self.manifest.name);
        for tool in &mut tools.tools {
            if tool.origin == "builtin" {
                tool.origin = origin.clone();
            }
            if tool.version.is_none() {
                tool.version = Some(self.manifest.version.clone());
            }
        }
        self.tools = tools.tools;
        Ok(())
    }

    /// Send one request and wait for its response.
    pub fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        let request = Request::new(id, method, params);
        let line = serde_json::to_string(&request)?;
        writeln!(self.stdin, "{line}")?;
        self.stdin.flush()?;

        let deadline = Instant::now() + self.timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(MellivoraError::Timeout(self.timeout.as_millis() as u64));
            }
            let raw = match self.responses.recv_timeout(remaining) {
                Ok(raw) => raw,
                Err(RecvTimeoutError::Timeout) => {
                    return Err(MellivoraError::Timeout(self.timeout.as_millis() as u64))
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(MellivoraError::Plugin(format!(
                        "pack '{}' exited before answering '{method}'",
                        self.manifest.name
                    )))
                }
            };

            // Packs sometimes print progress to stdout; ignore anything that is
            // not a well-formed response to *this* request.
            let response: Response = match serde_json::from_str(&raw) {
                Ok(response) => response,
                Err(_) => {
                    tracing::debug!(pack = %self.manifest.name, "ignoring non-protocol line on stdout");
                    continue;
                }
            };
            if response.id.is_some() && response.id != Some(id) {
                continue;
            }
            if let Some(error) = response.error {
                return Err(MellivoraError::Plugin(format!(
                    "pack '{}' error {}: {}",
                    self.manifest.name, error.code, error.message
                )));
            }
            return response.result.ok_or_else(|| {
                MellivoraError::Plugin(format!(
                    "pack '{}' returned neither result nor error for '{method}'",
                    self.manifest.name
                ))
            });
        }
    }

    pub fn shutdown(&mut self) {
        let _ = self.request(METHOD_SHUTDOWN, Value::Null);
    }
}

impl Drop for RunningPack {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A pack-provided tool, adapted so the registry cannot tell it apart from a
/// built-in. This is the whole point of the plugin layer: one contract.
#[derive(Debug, Clone)]
pub struct PluginTool {
    manifest: ToolManifest,
    tool_id: String,
    pack: Arc<Mutex<RunningPack>>,
}

impl PluginTool {
    pub fn new(manifest: ToolManifest, tool_id: String, pack: Arc<Mutex<RunningPack>>) -> Self {
        Self {
            manifest,
            tool_id,
            pack,
        }
    }
}

impl Tool for PluginTool {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, _ctx: &ToolContext, args: &Args) -> Result<Report> {
        let mut pack = self
            .pack
            .lock()
            .map_err(|_| MellivoraError::Internal("plugin host lock poisoned".to_string()))?;

        let denied: Vec<Capability> = self
            .manifest
            .capabilities
            .iter()
            .copied()
            .filter(|cap| !_ctx.granted.contains(*cap))
            .collect();
        if !denied.is_empty() {
            return Err(MellivoraError::CapabilityDenied(format!(
                "pack '{}' needs {}",
                pack.manifest.name,
                denied
                    .iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        }

        let params = json!({ "tool": self.tool_id, "args": args.as_map() });
        let value = pack.request(METHOD_RUN_TOOL, params)?;
        serde_json::from_value(value).map_err(|err| {
            MellivoraError::Plugin(format!(
                "pack '{}' returned an invalid report: {err}",
                pack.manifest.name
            ))
        })
    }
}

/// Discover manifests across directories.
pub fn discover(dirs: &[PathBuf]) -> (Vec<(PathBuf, PackManifest)>, Vec<PackFailure>) {
    let mut found = Vec::new();
    let mut failures = Vec::new();
    let mut seen: Vec<PathBuf> = Vec::new();

    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        for manifest_dir in manifest_dirs(dir, 3) {
            if seen.contains(&manifest_dir) {
                continue;
            }
            seen.push(manifest_dir.clone());
            let path = manifest_dir.join(MANIFEST_FILENAME);
            match PackManifest::load(&path) {
                Ok(manifest) => found.push((manifest_dir, manifest)),
                Err(err) => failures.push(PackFailure {
                    manifest_path: path,
                    error: err.to_string(),
                }),
            }
        }
    }

    found.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    (found, failures)
}

/// Owns every running pack for the lifetime of a command or server.
#[derive(Default)]
pub struct PluginHost {
    packs: Vec<Arc<Mutex<RunningPack>>>,
    failures: Vec<PackFailure>,
}

impl std::fmt::Debug for PluginHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PluginHost")
            .field("packs", &self.packs.len())
            .field("failures", &self.failures.len())
            .finish()
    }
}

impl PluginHost {
    /// Discover and start every enabled pack. A broken pack never prevents the
    /// toolkit from running; it is recorded in [`PluginHost::failures`].
    pub fn load(dirs: &[PathBuf], disabled: &[String], timeout: Duration) -> Self {
        let (found, mut failures) = discover(dirs);
        let mut packs = Vec::new();

        for (dir, manifest) in found {
            if !manifest.enabled || disabled.iter().any(|name| name == &manifest.name) {
                continue;
            }
            let pack_timeout = manifest
                .timeout_ms
                .map(Duration::from_millis)
                .unwrap_or(timeout);
            match RunningPack::start(&dir, manifest, pack_timeout).and_then(|mut pack| {
                pack.handshake()?;
                Ok(pack)
            }) {
                Ok(pack) => {
                    tracing::debug!(pack = %pack.manifest.name, tools = pack.tools.len(), "pack ready");
                    packs.push(Arc::new(Mutex::new(pack)));
                }
                Err(err) => {
                    tracing::warn!(pack_dir = %dir.display(), %err, "pack failed to load");
                    failures.push(PackFailure {
                        manifest_path: dir.join(MANIFEST_FILENAME),
                        error: err.to_string(),
                    });
                }
            }
        }

        Self { packs, failures }
    }

    /// Adapter objects for every tool every pack exposes.
    pub fn tools(&self) -> Vec<Arc<dyn Tool>> {
        let mut tools: Vec<Arc<dyn Tool>> = Vec::new();
        for pack in &self.packs {
            let Ok(guard) = pack.lock() else { continue };
            for manifest in &guard.tools {
                tools.push(Arc::new(PluginTool::new(
                    manifest.clone(),
                    manifest.id.clone(),
                    Arc::clone(pack),
                )));
            }
        }
        tools
    }

    pub fn summaries(&self) -> Vec<PackSummary> {
        let mut summaries = Vec::new();
        for pack in &self.packs {
            let Ok(guard) = pack.lock() else { continue };
            summaries.push(PackSummary {
                name: guard.manifest.name.clone(),
                version: guard.manifest.version.clone(),
                description: guard.manifest.description.clone(),
                dir: guard.dir.clone(),
                tool_count: guard.tools.len(),
                capabilities: guard.manifest.capabilities.clone(),
            });
        }
        summaries
    }

    pub fn failures(&self) -> &[PackFailure] {
        &self.failures
    }

    pub fn is_empty(&self) -> bool {
        self.packs.is_empty()
    }

    pub fn shutdown(&mut self) {
        for pack in self.packs.drain(..) {
            if let Ok(mut guard) = pack.lock() {
                guard.shutdown();
            }
        }
    }
}

impl Drop for PluginHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Convenience for building `run_tool` params, shared with pack authors in docs.
pub fn run_tool_params(tool: &str, args: &BTreeMap<String, Value>) -> Value {
    json!({ "tool": tool, "args": args })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mellivora-host-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn discovers_and_reports_broken_packs() {
        let dir = temp_dir("broken");
        let pack_dir = dir.join("broken");
        fs::create_dir_all(&pack_dir).expect("pack dir");
        fs::write(
            pack_dir.join(MANIFEST_FILENAME),
            "name = \"\"\nversion = \"1\"\ncommand = []\n",
        )
        .expect("write");

        let (found, failures) = discover(std::slice::from_ref(&dir));
        assert!(found.is_empty());
        assert_eq!(failures.len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_pack_directory_is_not_an_error() {
        let (found, failures) = discover(&[PathBuf::from("/nonexistent/mellivora/packs")]);
        assert!(found.is_empty());
        assert!(failures.is_empty());
    }
}
