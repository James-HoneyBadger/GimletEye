//! OpenPGP interop by driving the system `gpg`.
//!
//! This is a migration path, not a second implementation of OpenPGP: it exists
//! so a user who already has GPG keys can verify and encrypt with them. Writing
//! an OpenPGP implementation would be months of work and a large new parser to
//! fuzz - the opposite of what the 1.0 gates ask for. See
//! `docs/adr/0007-keystore-and-recipients.md`.
//!
//! Every invocation passes paths as separate arguments (never through a shell),
//! runs `--batch` with no TTY, and turns `gpg`'s own status lines into data. A
//! missing `gpg` is an error that says so, not a silent "invalid signature".

use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;

use mellivora_core::{
    ArgKind, ArgSpec, Args, Capability, Category, MellivoraError, Report, Result, Tool,
    ToolContext, ToolManifest,
};
use serde_json::{json, Value};

use crate::operations::{ensure_distinct, ensure_writable};

const PROGRAM: &str = "gpg";

fn gpg_home_args(homedir: Option<&Path>) -> Vec<std::ffi::OsString> {
    match homedir {
        Some(dir) => vec!["--homedir".into(), dir.as_os_str().to_owned()],
        None => Vec::new(),
    }
}

/// What one `gpg` run produced. Kept as data rather than an error because
/// `--verify` exits non-zero for reasons only the status lines explain: a bad
/// signature and a missing key both fail, and they are not the same problem.
struct GpgRun {
    success: bool,
    status: String,
    stderr: String,
}

impl GpgRun {
    /// The first meaningful line of gpg's own diagnosis, cleaned for a report.
    fn complaint(&self) -> String {
        self.stderr
            .lines()
            .map(|line| line.trim().trim_start_matches("gpg: "))
            .find(|line| !line.is_empty())
            .unwrap_or("gpg reported a failure")
            .to_string()
    }
}

fn run_gpg(home: &[std::ffi::OsString], args: &[std::ffi::OsString]) -> Result<GpgRun> {
    let output = Command::new(PROGRAM)
        .args(home)
        .args(args)
        .output()
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                MellivoraError::NotFound(format!(
                    "'{PROGRAM}' is not installed; OpenPGP interop needs it on PATH"
                ))
            } else {
                MellivoraError::Tool(format!("{PROGRAM} could not be started: {err}"))
            }
        })?;
    Ok(GpgRun {
        success: output.status.success(),
        status: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// The payload of the first `[GNUPG:] <keyword> ...` status line.
fn status_line<'a>(status: &'a str, keyword: &str) -> Option<&'a str> {
    status
        .lines()
        .filter_map(|line| line.strip_prefix("[GNUPG:] "))
        .find(|line| line.starts_with(keyword))
}

/// Field `n` of a status line, counting from the keyword: `GOODSIG KEY name`.
fn status_field<'a>(status: &'a str, keyword: &str, n: usize) -> Option<&'a str> {
    status_line(status, keyword)?.split_whitespace().nth(n)
}

/// Everything after the key id on a `GOODSIG`/`BADSIG` line, spaces included.
fn status_after_id<'a>(status: &'a str, keyword: &str) -> Option<&'a str> {
    status_line(status, keyword)?.splitn(3, ' ').nth(2)
}

/// Verify a detached signature with the user's GnuPG keyring.
pub struct GpgVerify {
    manifest: ToolManifest,
}

impl GpgVerify {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.gpg-verify",
                "Verify a GnuPG signature",
                "Check a detached signature with the system gpg and its keyring",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::ProcessExec])
            .with_args([
                ArgSpec::new("input", ArgKind::Path)
                    .required()
                    .help("Signed file"),
                ArgSpec::new("signature", ArgKind::Path)
                    .required()
                    .help("Detached signature to check"),
                ArgSpec::new("homedir", ArgKind::Path)
                    .help("GnuPG home directory (default: gpg's own)"),
            ])
            .with_tags(["gpg", "openpgp", "signature", "interop"]),
        }
    }
}

impl Default for GpgVerify {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for GpgVerify {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        ctx.require(Capability::ProcessExec)?;
        let started = Instant::now();

        let input = args.require_path("input")?;
        let signature = args.require_path("signature")?;
        for path in [&input, &signature] {
            if !path.is_file() {
                return Err(MellivoraError::NotFound(path.display().to_string()));
            }
        }
        let home = gpg_home_args(args.opt_path("homedir")?.as_deref());

        let run = run_gpg(
            &home,
            &[
                "--batch".into(),
                "--no-tty".into(),
                "--status-fd".into(),
                "1".into(),
                "--verify".into(),
                signature.as_os_str().to_owned(),
                input.as_os_str().to_owned(),
            ],
        )?;

        // `VALIDSIG <fingerprint> <date> ...`, `GOODSIG <keyid> <name>`,
        // `BADSIG <keyid> <name>`, `ERRSIG <keyid> ...` - the fingerprint is the
        // first field, the key id is the first field of the others.
        let Some(fingerprint) = status_field(&run.status, "VALIDSIG", 1) else {
            let problem = if let Some(key) = status_field(&run.status, "BADSIG", 1) {
                format!("signature does not match the file (key {key})")
            } else if let Some(key) = status_field(&run.status, "ERRSIG", 1) {
                format!("signing key {key} is not in the keyring")
            } else if !run.success {
                run.complaint()
            } else {
                "gpg did not report a valid signature".to_string()
            };
            return Err(MellivoraError::Tool(problem));
        };

        let fingerprint = fingerprint.to_string();
        let signer = status_after_id(&run.status, "GOODSIG")
            .unwrap_or("unknown")
            .to_string();

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "signature is valid for {} (key {})",
                input.display(),
                &fingerprint[..fingerprint.len().min(16)]
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "signature": signature.display().to_string(),
                "valid": true,
                "fingerprint": fingerprint,
                "signer": signer,
                "backend": PROGRAM,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Encrypt a file to an OpenPGP recipient with the system gpg.
pub struct GpgEncrypt {
    manifest: ToolManifest,
}

impl GpgEncrypt {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.gpg-encrypt",
                "Encrypt for a GnuPG recipient",
                "Produce an OpenPGP message with the system gpg, for people who already have GPG keys",
                Category::Crypto,
            )
            .with_capabilities([
                Capability::FsRead,
                Capability::FsWrite,
                Capability::ProcessExec,
            ])
            .with_args([
                ArgSpec::new("input", ArgKind::Path)
                    .required()
                    .help("File to encrypt"),
                ArgSpec::new("recipient", ArgKind::String).required().help(
                    "Recipient key id, fingerprint, or email as gpg knows it",
                ),
                ArgSpec::new("output", ArgKind::Path)
                    .help("Destination (default: <input>.gpg)"),
                ArgSpec::new("homedir", ArgKind::Path)
                    .help("GnuPG home directory (default: gpg's own)"),
                ArgSpec::new("overwrite", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace the output file if it exists"),
            ])
            .with_tags(["gpg", "openpgp", "encryption", "interop"])
            .mutating(),
        }
    }
}

impl Default for GpgEncrypt {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for GpgEncrypt {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        ctx.require(Capability::ProcessExec)?;
        let started = Instant::now();

        let input = args.require_path("input")?;
        if !input.is_file() {
            return Err(MellivoraError::NotFound(input.display().to_string()));
        }
        let recipient = args.require_str("recipient")?;
        let overwrite = args.bool_or("overwrite", false)?;
        let target = match args.opt_path("output")? {
            Some(path) => path,
            None => {
                let name = input.file_name().unwrap_or_default().to_string_lossy();
                input.with_file_name(format!("{name}.gpg"))
            }
        };
        ensure_distinct(&input, &target)?;
        ensure_writable(ctx, &target, overwrite)?;
        let home = gpg_home_args(args.opt_path("homedir")?.as_deref());

        let mut command: Vec<std::ffi::OsString> = vec![
            "--batch".into(),
            "--no-tty".into(),
            // The user named this recipient explicitly, so a locally imported key
            // must be usable without first being "trusted" interactively.
            "--trust-model".into(),
            "always".into(),
            "--output".into(),
            target.as_os_str().to_owned(),
            "--encrypt".into(),
            "--recipient".into(),
            recipient.clone().into(),
        ];
        if overwrite {
            command.push("--yes".into());
        }
        command.push(input.as_os_str().to_owned());

        if ctx.dry_run {
            return Ok(Report::new(&self.manifest.id)
                .with_summary(format!(
                    "would encrypt {} for {recipient} → {}",
                    input.display(),
                    target.display()
                ))
                .with_data(json!({
                    "input": input.display().to_string(),
                    "output": Value::Null,
                    "recipient": recipient,
                    "output_bytes": 0,
                    "backend": PROGRAM,
                    "dry_run": true,
                }))
                .with_duration(started.elapsed())
                .sealed());
        }

        ctx.require(Capability::FsWrite)?;
        let run = run_gpg(&home, &command)?;
        if !run.success {
            return Err(MellivoraError::Tool(format!(
                "{PROGRAM} failed: {}",
                run.complaint()
            )));
        }
        let bytes = std::fs::metadata(&target)?.len();

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "encrypted {} for {recipient} → {} ({bytes} bytes)",
                input.display(),
                target.display()
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "output": target.display().to_string(),
                "recipient": recipient,
                "output_bytes": bytes,
                "backend": PROGRAM,
                "dry_run": false,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Where the tools are exported with a concrete backend-free signature.
pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    Ok(vec![
        Arc::new(GpgVerify::new()),
        Arc::new(GpgEncrypt::new()),
    ])
}
