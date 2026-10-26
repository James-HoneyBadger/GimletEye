use std::collections::{BTreeMap, BTreeSet};
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

        // The manifest is the contract the operator granted, so a tool may
        // narrow it but never widen it: a pack that hides `network` from its
        // manifest cannot smuggle it in through `list_tools`.
        if let Some((tool, capability)) =
            undeclared_capabilities(&self.manifest, &tools.tools).first()
        {
            return Err(MellivoraError::Plugin(format!(
                "pack '{}' exposes '{tool}' which requests {capability} that its manifest does not declare",
                self.manifest.name
            )));
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
            // A reply must echo *this* request's id. Notifications (no id) and
            // answers to an earlier request are skipped rather than mistaken for
            // the reply — taking one would leave every later call reading a
            // stale answer.
            if response.id != Some(id) {
                tracing::debug!(
                    pack = %self.manifest.name,
                    id = ?response.id,
                    "ignoring a message that does not answer this request"
                );
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

    /// Wait for the child to exit on its own, killing it only if it will not.
    ///
    /// `shutdown()` deliberately ignores the outcome, which is right for a
    /// long-lived host and wrong for a conformance run: there, "the pack left a
    /// process behind" is the finding.
    pub fn wait_for_exit(&mut self, grace: Duration) -> bool {
        let deadline = Instant::now() + grace;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Ok(None) => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return false;
                }
                Err(_) => return false,
            }
        }
    }
}

impl Drop for RunningPack {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Capabilities a pack's tools request that its manifest never declared.
///
/// Checked once at handshake time, so the grant an operator configures always
/// covers the whole pack rather than only the tool that happens to be called.
fn undeclared_capabilities(
    manifest: &PackManifest,
    tools: &[ToolManifest],
) -> Vec<(String, Capability)> {
    let declared: BTreeSet<Capability> = manifest.capabilities.iter().copied().collect();
    let mut problems = Vec::new();
    for tool in tools {
        for capability in &tool.capabilities {
            if !declared.contains(capability) {
                problems.push((tool.id.clone(), *capability));
            }
        }
    }
    problems
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

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        let mut pack = self
            .pack
            .lock()
            .map_err(|_| MellivoraError::Internal("plugin host lock poisoned".to_string()))?;

        // Dispatch needs the pack's own declaration *and* the tool's narrower
        // one to be granted, so `plugins.allow` constrains what the pack as a
        // whole may do rather than only what a single tool admits to.
        let mut missing: Vec<Capability> = pack
            .manifest
            .capabilities
            .iter()
            .copied()
            .filter(|capability| !ctx.granted.contains(*capability))
            .collect();
        for capability in &self.manifest.capabilities {
            if !ctx.granted.contains(*capability) && !missing.contains(capability) {
                missing.push(*capability);
            }
        }
        if !missing.is_empty() {
            return Err(MellivoraError::CapabilityDenied(format!(
                "pack '{}' needs {}",
                pack.manifest.name,
                missing
                    .iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        }

        // `dry_run` is a host flag, not a tool argument: a pack that would write
        // has no other way to know the user asked it not to. Without it the SDK
        // rule "honour `--dry-run`" was unimplementable.
        let params = run_tool_params(&self.tool_id, args.as_map(), ctx.dry_run);
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
        let (found, failures) = discover(dirs);
        Self::start(found, disabled, timeout, failures)
    }

    /// Start an already-discovered set of packs.
    ///
    /// The caller supplies the list, which is what lets a layer above decide
    /// what is allowed to run — pack trust is checked there, so this file stays
    /// a mechanism rather than a policy.
    pub fn start(
        found: Vec<(PathBuf, PackManifest)>,
        disabled: &[String],
        timeout: Duration,
        mut failures: Vec<PackFailure>,
    ) -> Self {
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
/// The `run_tool` payload.
///
/// `dry_run` sits beside `args`, not inside it, so a tool cannot be handed a
/// flag it did not declare and a pack cannot mistake it for one of its own
/// arguments. Packs that predate the field ignore it.
pub fn run_tool_params(tool: &str, args: &BTreeMap<String, Value>, dry_run: bool) -> Value {
    json!({ "tool": tool, "args": args, "dry_run": dry_run })
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

    fn pack_manifest(capabilities: Vec<Capability>) -> PackManifest {
        PackManifest {
            name: "demo".into(),
            version: "0.0.0".into(),
            protocol_version: PROTOCOL_VERSION,
            description: None,
            command: vec!["true".into()],
            enabled: true,
            capabilities,
            timeout_ms: None,
            env: BTreeMap::new(),
        }
    }

    /// A pack that emits a notification before its reply. The host must skip the
    /// notification rather than treat it as the answer to the request.
    const NOISY_PACK: &str = r#"
while IFS= read -r line; do
    case "$line" in
        *'"initialize"'*)
            printf '%s\n' '{"jsonrpc":"2.0","method":"log","params":{"note":"progress"}}'
            printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocol_version":1,"name":"noisy","version":"0.1.0","capabilities":["run","list_tools"]}}'
            ;;
        *'"list_tools"'*)
            printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}'
            ;;
        *'"shutdown"'*)
            printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{}}'
            exit 0
            ;;
    esac
done
"#;

    const DRY_RUN_PACK: &str = r#"
while IFS= read -r line; do
    # Every reply echoes the id it answers, which is how the host matches them.
    id=$(printf '%s' "$line" | sed -n 's/.*"id":[ ]*\([0-9]*\).*/\1/p')
    case "$line" in
        *'"initialize"'*)
            printf '{"jsonrpc":"2.0","id":%s,"result":{"protocol_version":1,"name":"dry","version":"0.1.0","capabilities":["run","list_tools"]}}\n' "$id"
            ;;
        *'"list_tools"'*)
            printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"id":"dry.echo","title":"Echo","summary":"echo","category":"sysadmin","capabilities":[]}]}}\n' "$id"
            ;;
        *'"run_tool"'*)
            case "$line" in
                *'"dry_run":true'*) verdict=would-write ;;
                *) verdict=wrote ;;
            esac
            printf '{"jsonrpc":"2.0","id":%s,"result":{"tool":"dry.echo","status":"ok","summary":"%s","findings":[],"data":{},"warnings":[],"duration_ms":0}}\n' "$id" "$verdict"
            ;;
        *'"shutdown"'*)
            printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
            exit 0
            ;;
    esac
done
"#;

    /// A pack cannot know the user asked for a dry run unless the host says so.
    #[cfg(unix)]
    #[test]
    fn a_pack_is_told_when_the_run_is_a_dry_run() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("dryrun");
        let pack_dir = dir.join("dry");
        fs::create_dir_all(&pack_dir).expect("pack dir");
        let script = pack_dir.join("pack.sh");
        fs::write(&script, DRY_RUN_PACK).expect("write script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");

        let mut manifest = pack_manifest(Vec::new());
        manifest.name = "dry".into();
        manifest.command = vec!["sh".into(), "pack.sh".into()];

        let mut pack =
            RunningPack::start(&pack_dir, manifest, Duration::from_secs(5)).expect("start pack");
        pack.handshake().expect("handshake");
        assert_eq!(pack.tools.len(), 1);

        let tool = PluginTool::new(
            pack.tools[0].clone(),
            "dry.echo".into(),
            Arc::new(Mutex::new(pack)),
        );
        let context = ToolContext::new(crate::AppPaths::under(dir.join("home")));

        let wet = tool.run(&context, &Args::new()).expect("run");
        assert_eq!(wet.summary, "wrote");

        let dry = tool
            .run(&context.clone().with_dry_run(true), &Args::new())
            .expect("dry run");
        assert_eq!(dry.summary, "would-write", "the pack was not told");

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_notification_before_the_reply_does_not_consume_it() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("noisy");
        let pack_dir = dir.join("noisy");
        fs::create_dir_all(&pack_dir).expect("pack dir");
        let script = pack_dir.join("pack.sh");
        fs::write(&script, NOISY_PACK).expect("write script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");

        let mut manifest = pack_manifest(Vec::new());
        manifest.name = "noisy".into();
        manifest.command = vec!["sh".into(), "pack.sh".into()];

        let mut pack =
            RunningPack::start(&pack_dir, manifest, Duration::from_secs(5)).expect("start pack");
        pack.handshake()
            .expect("the handshake must skip the notification and use the reply");
        assert!(pack.tools.is_empty());
        pack.shutdown();

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_tool_may_not_request_capabilities_the_manifest_omits() {
        use crate::tool::Category;

        let manifest = pack_manifest(vec![Capability::FsRead]);
        let honest = ToolManifest::new("demo.read", "Read", "reads", Category::Sysadmin)
            .with_capabilities([Capability::FsRead]);
        assert!(undeclared_capabilities(&manifest, &[honest]).is_empty());

        let widened = ToolManifest::new("demo.sneaky", "Sneaky", "calls home", Category::Sysadmin)
            .with_capabilities([Capability::FsRead, Capability::Network]);
        assert_eq!(
            undeclared_capabilities(&manifest, &[widened]),
            vec![("demo.sneaky".to_string(), Capability::Network)]
        );
    }
}
