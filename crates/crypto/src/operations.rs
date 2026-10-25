//! File-level cryptographic operations: encrypt, decrypt, inspect, sign,
//! verify, and key generation.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use mellivora_core::{
    ArgKind, ArgSpec, Args, Capability, Category, MellivoraError, Report, Result, Tool,
    ToolContext, ToolManifest,
};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::backend::{AeadAlgorithm, CryptoBackend, KdfParams};
use crate::container;
use crate::keys::{self, Ed25519KeyPair};
use crate::keystore;

const ALGORITHMS: [&str; 2] = ["chacha20-poly1305", "aes256-gcm"];

pub(crate) fn passphrase_args() -> [ArgSpec; 2] {
    [
        ArgSpec::new("passphrase_env", ArgKind::String)
            .help("Environment variable holding the passphrase (preferred: keeps it out of shell history)"),
        ArgSpec::new("passphrase", ArgKind::String)
            .help("Passphrase inline; visible to other local users and in shell history"),
    ]
}

pub(crate) fn input_arg(help: &str) -> ArgSpec {
    ArgSpec::new("input", ArgKind::Path).required().help(help)
}

/// Resolve the passphrase from the environment (preferred) or the argument.
pub(crate) fn passphrase(args: &Args) -> Result<Zeroizing<Vec<u8>>> {
    if let Some(variable) = args.opt_str("passphrase_env")? {
        let value = std::env::var(&variable).map_err(|_| {
            MellivoraError::InvalidArgs(format!("environment variable '{variable}' is not set"))
        })?;
        if value.is_empty() {
            return Err(MellivoraError::InvalidArgs(format!(
                "environment variable '{variable}' is empty"
            )));
        }
        return Ok(Zeroizing::new(value.into_bytes()));
    }

    if let Some(value) = args.opt_str("passphrase")? {
        if value.is_empty() {
            return Err(MellivoraError::InvalidArgs("passphrase is empty".into()));
        }
        return Ok(Zeroizing::new(value.into_bytes()));
    }

    Err(MellivoraError::InvalidArgs(
        "provide 'passphrase_env' (preferred) or 'passphrase'".into(),
    ))
}

pub(crate) fn read_file(path: &Path) -> Result<Vec<u8>> {
    if !path.exists() {
        return Err(MellivoraError::NotFound(path.display().to_string()));
    }
    Ok(fs::read(path)?)
}

/// Refuse to clobber an existing file unless the caller asked for it.
pub(crate) fn ensure_writable(context: &ToolContext, target: &Path, overwrite: bool) -> Result<()> {
    if !context.dry_run && target.exists() && !overwrite {
        return Err(MellivoraError::Config(format!(
            "{} already exists (use overwrite=true to replace it)",
            target.display()
        )));
    }
    Ok(())
}

/// Stream into a sibling temporary file and rename it into place.
///
/// A container that fails halfway through is not written at the destination:
/// for a large file that is the difference between an error and a plausible
/// looking file that cannot be opened.
pub(crate) fn stream_to_file<F>(context: &ToolContext, target: &Path, write: F) -> Result<()>
where
    F: FnOnce(BufWriter<File>) -> Result<()>,
{
    context.require(Capability::FsWrite)?;
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temp = target.with_file_name(format!("{name}.tmp"));

    let file = File::create(&temp)?;
    let outcome = write(BufWriter::new(file));
    if let Err(err) = outcome.and_then(|()| Ok(fs::rename(&temp, target)?)) {
        let _ = fs::remove_file(&temp);
        return Err(err);
    }
    Ok(())
}

/// Refuse a target that is the input itself, which would truncate the source
/// before it is read.
pub(crate) fn ensure_distinct(input: &Path, target: &Path) -> Result<()> {
    let same = match (input.canonicalize(), target.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => input == target,
    };
    if same {
        return Err(MellivoraError::InvalidArgs(format!(
            "output {} is the input file; choose another path",
            target.display()
        )));
    }
    Ok(())
}

pub(crate) fn write_file(context: &ToolContext, target: &Path, bytes: &[u8]) -> Result<()> {
    if context.dry_run {
        return Ok(());
    }
    context.require(Capability::FsWrite)?;
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(target, bytes)?;
    Ok(())
}

/// Resolve `--to` into recipient public keys: `.pub` files, key files, or bare
/// 64-character hex.
fn resolve_recipients(value: &str) -> Result<Vec<[u8; 32]>> {
    let mut recipients = Vec::new();
    for item in value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let bytes = if item.len() == 64 && item.chars().all(|c| c.is_ascii_hexdigit()) {
            keys::hex_decode(item)?
                .try_into()
                .map_err(|_| MellivoraError::InvalidArgs("recipient key is not 32 bytes".into()))?
        } else {
            let path = Path::new(item);
            if !path.is_file() {
                return Err(MellivoraError::NotFound(format!(
                    "recipient key {item} is neither a 64-character hex key nor a file"
                )));
            }
            let text = String::from_utf8(read_file(path)?)
                .map_err(|_| MellivoraError::InvalidArgs(format!("key file {item} is not text")))?;
            keys::decode_x25519_public(&text)?
        };
        recipients.push(bytes);
    }
    if recipients.is_empty() {
        return Err(MellivoraError::InvalidArgs(
            "provide at least one recipient key with 'to'".into(),
        ));
    }
    Ok(recipients)
}

fn encrypted_path(input: &Path) -> PathBuf {
    let name = input.file_name().unwrap_or_default().to_string_lossy();
    input.with_file_name(format!("{name}.{}", container::EXTENSION))
}

fn decrypted_path(input: &Path) -> PathBuf {
    if input.extension().and_then(|ext| ext.to_str()) == Some(container::EXTENSION) {
        return input.with_extension("");
    }
    let stem = input.file_stem().unwrap_or_default().to_string_lossy();
    input.with_file_name(format!("{stem}.decrypted"))
}

/// Encrypt a file into a `.melv` container.
pub struct Encrypt {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl Encrypt {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.encrypt",
                "Encrypt a file",
                "Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite, Capability::Secrets])
            .with_args([
                input_arg("File to encrypt"),
                ArgSpec::new("output", ArgKind::Path)
                    .help("Destination path (default: <input>.melv)"),
                ArgSpec::new(
                    "algorithm",
                    ArgKind::Enum {
                        values: ALGORITHMS.iter().map(|value| value.to_string()).collect(),
                    },
                )
                .default_value(Value::from("chacha20-poly1305"))
                .help("Authenticated cipher"),
                ArgSpec::new("to", ArgKind::String).help(
                    "Recipient public keys: comma-separated .pub files or 64-hex keys (writes a version 3 container instead of using a passphrase)",
                ),
                passphrase_args()[0].clone(),
                passphrase_args()[1].clone(),
                ArgSpec::new("overwrite", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace the output file if it exists"),
            ])
            .with_tags(["encryption", "container", "aead", "recipients"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for Encrypt {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let input = args.require_path("input")?;
        if !input.is_file() {
            return Err(MellivoraError::NotFound(input.display().to_string()));
        }
        let algorithm = match args.opt_str("algorithm")? {
            Some(value) => AeadAlgorithm::parse(&value)?,
            None => AeadAlgorithm::ChaCha20Poly1305,
        };
        let target = args
            .opt_path("output")?
            .unwrap_or_else(|| encrypted_path(&input));
        let params = KdfParams::default();
        let recipients = match args.opt_str("to")? {
            Some(value) => Some(resolve_recipients(&value)?),
            None => None,
        };
        let passphrase = match recipients {
            Some(_) => Zeroizing::new(Vec::new()),
            None => passphrase(args)?,
        };

        ensure_distinct(&input, &target)?;
        ensure_writable(ctx, &target, args.bool_or("overwrite", false)?)?;

        let stats = if ctx.dry_run {
            // Nothing is written, so nothing is encrypted either: report what
            // the run would produce from the input's size.
            let bytes = fs::metadata(&input)?.len();
            container::StreamStats {
                version: if recipients.is_some() {
                    container::VERSION_RECIPIENT
                } else {
                    container::VERSION_STREAMING
                },
                chunks: bytes.div_ceil(container::CHUNK_SIZE as u64).max(1),
                plaintext_bytes: bytes,
                container_bytes: 0,
            }
        } else {
            let source = BufReader::new(File::open(&input)?);
            let mut stats = None;
            stream_to_file(ctx, &target, |sink| {
                stats = Some(match &recipients {
                    Some(keys) => container::seal_for_recipients(
                        &*self.backend,
                        algorithm,
                        keys,
                        source,
                        sink,
                    )?,
                    None => container::seal_stream(
                        &*self.backend,
                        passphrase.as_ref(),
                        algorithm,
                        params,
                        source,
                        sink,
                    )?,
                });
                Ok(())
            })?;
            stats.unwrap_or_default()
        };

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {} → {} ({}, {}, {} chunk(s))",
                if ctx.dry_run { "would encrypt" } else { "encrypted" },
                input.display(),
                target.display(),
                algorithm.as_str(),
                match &recipients {
                    Some(keys) => format!("x25519 to {} recipient(s)", keys.len()),
                    None => "argon2id".to_string(),
                },
                stats.chunks
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "output": if ctx.dry_run { Value::Null } else { Value::String(target.display().to_string()) },
                "algorithm": algorithm,
                "kdf": match &recipients {
                    Some(_) => Value::from("x25519-hkdf-sha256"),
                    None => serde_json::to_value(params).unwrap_or(Value::Null),
                },
                "recipients": recipients.as_ref().map(|keys| keys.len()).unwrap_or(0),
                "container_version": stats.version,
                "chunk_size_bytes": container::CHUNK_SIZE,
                "chunks": stats.chunks,
                "plaintext_bytes": stats.plaintext_bytes,
                "container_bytes": if ctx.dry_run { 0 } else { stats.container_bytes },
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Decrypt a `.melv` container.
pub struct Decrypt {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl Decrypt {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.decrypt",
                "Decrypt a file",
                "Open an authenticated container with its passphrase",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite, Capability::Secrets])
            .with_args([
                input_arg("Container to decrypt"),
                ArgSpec::new("output", ArgKind::Path)
                    .help("Destination path (default: input without the .melv suffix)"),
                ArgSpec::new("key", ArgKind::Path).help(
                    "Recipient secret key file (<label>.key); required for version 3 containers",
                ),
                passphrase_args()[0].clone(),
                passphrase_args()[1].clone(),
                ArgSpec::new("overwrite", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace the output file if it exists"),
            ])
            .with_tags(["decryption", "container", "aead"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for Decrypt {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let input = args.require_path("input")?;
        if !input.is_file() {
            return Err(MellivoraError::NotFound(input.display().to_string()));
        }
        let target = args
            .opt_path("output")?
            .unwrap_or_else(|| decrypted_path(&input));
        let recipient = match args.opt_path("key")? {
            Some(path) => {
                let text = String::from_utf8(read_file(&path)?)
                    .map_err(|_| MellivoraError::InvalidArgs("key file is not text".into()))?;
                Some(Zeroizing::new(keys::decode_x25519_secret(&text)?))
            }
            None => None,
        };
        let passphrase = match recipient {
            Some(_) => Zeroizing::new(Vec::new()),
            None => passphrase(args)?,
        };

        ensure_distinct(&input, &target)?;
        ensure_writable(ctx, &target, args.bool_or("overwrite", false)?)?;

        // A dry run still verifies the key and every chunk — it just discards
        // the plaintext instead of writing it.
        let open = |source: BufReader<File>, sink: &mut dyn std::io::Write| match &recipient {
            Some(secret) => container::open_for_recipient(&*self.backend, secret, source, sink),
            None => container::open_stream(&*self.backend, passphrase.as_ref(), source, sink),
        };

        let (header, stats) = if ctx.dry_run {
            let mut sink = std::io::sink();
            open(BufReader::new(File::open(&input)?), &mut sink)?
        } else {
            let source = BufReader::new(File::open(&input)?);
            let mut opened = None;
            stream_to_file(ctx, &target, |mut sink| {
                opened = Some(open(source, &mut sink)?);
                Ok(())
            })?;
            opened.expect("open ran inside stream_to_file")
        };

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {} → {} ({}, {} chunk(s))",
                if ctx.dry_run { "would decrypt" } else { "decrypted" },
                input.display(),
                target.display(),
                header.algorithm.as_str(),
                stats.chunks
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "output": if ctx.dry_run { Value::Null } else { Value::String(target.display().to_string()) },
                "algorithm": header.algorithm,
                "container_version": header.version,
                "chunks": stats.chunks,
                "plaintext_bytes": stats.plaintext_bytes,
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Read a container header without the passphrase.
pub struct Inspect {
    manifest: ToolManifest,
}

impl Inspect {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.inspect",
                "Inspect a container",
                "Report the cipher, KDF parameters, and lengths of an encrypted container",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead])
            .with_args([input_arg("Container to inspect")])
            .with_tags(["container", "inspection", "metadata"]),
        }
    }
}

impl Default for Inspect {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for Inspect {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        let started = Instant::now();
        let input = args.require_path("input")?;
        if !input.is_file() {
            return Err(MellivoraError::NotFound(input.display().to_string()));
        }
        let bytes = fs::metadata(&input)?.len();
        let mut file = BufReader::new(File::open(&input)?);
        let header = container::inspect_stream(&mut file)?;
        // Versions 2 and 3 share the chunk stream; a v3 header is simply longer
        // because of its recipient block.
        let streaming = matches!(
            header.version,
            container::VERSION_STREAMING | container::VERSION_RECIPIENT
        );
        let header_bytes = match header.version {
            container::VERSION_RECIPIENT => {
                container::RECIPIENT_PREFIX_LEN
                    + header.recipients.len() * container::RECIPIENT_ENTRY_LEN
                    + container::NONCE_LEN
            }
            _ => container::HEADER_LEN,
        };

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} · {} · {} · {}",
                input.display(),
                header.algorithm.as_str(),
                match &header.kdf {
                    crate::container::Kdf::Argon2id(params) => format!(
                        "argon2id {} KiB/{} iterations",
                        params.m_cost_kib, params.t_cost
                    ),
                    crate::container::Kdf::X25519HkdfSha256 => {
                        format!("{} recipient(s)", header.recipients.len())
                    }
                },
                if streaming {
                    "chunked"
                } else {
                    "single message"
                }
            ))
            .with_data(json!({
                "path": input.display().to_string(),
                "container_version": header.version,
                "streaming": streaming,
                "max_chunk_bytes": if streaming { Value::from(container::CHUNK_SIZE) } else { Value::Null },
                "algorithm": header.algorithm,
                "kdf": header.kdf,
                "salt": if header.salt_hex.is_empty() { Value::Null } else { Value::String(header.salt_hex.clone()) },
                "ephemeral_key": if header.ephemeral_hex.is_empty() { Value::Null } else { Value::String(header.ephemeral_hex.clone()) },
                "recipient_count": header.recipients.len(),
                "recipients": header.recipients,
                "container_bytes": bytes,
                "ciphertext_bytes": bytes.saturating_sub(header_bytes as u64),
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Generate an Ed25519 keypair.
pub struct KeyGen {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl KeyGen {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.keygen",
                "Generate a signing key",
                "Create an Ed25519 keypair; the secret file is written owner-only",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsWrite, Capability::Secrets])
            .with_args(
                [
                    ArgSpec::new("label", ArgKind::String)
                        .default_value(Value::from("default"))
                        .help("Key name; files are <label>.key and <label>.pub"),
                    ArgSpec::new(
                        "kind",
                        ArgKind::Enum {
                            values: vec!["ed25519".to_string(), "x25519".to_string()],
                        },
                    )
                    .default_value(Value::from("ed25519"))
                    .help("ed25519 signs, x25519 receives encrypted files"),
                    ArgSpec::new("dir", ArgKind::Path)
                        .default_value(Value::from("."))
                        .help("Directory to write the key files into"),
                    ArgSpec::new("keystore", ArgKind::Boolean)
                        .default_value(Value::Bool(false))
                        .help("Store the key in the sealed keystore instead of writing files"),
                    ArgSpec::new("overwrite", ArgKind::Boolean)
                        .default_value(Value::Bool(false))
                        .help("Replace existing key files"),
                ]
                .into_iter()
                .chain(passphrase_args())
                .collect::<Vec<_>>(),
            )
            .with_tags(["keys", "ed25519", "x25519", "keystore"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for KeyGen {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let label = args.str_or("label", "default")?;
        if label.contains('/') || label.contains('\\') || label == "." || label == ".." {
            return Err(MellivoraError::InvalidArgs(
                "label must be a plain file name".into(),
            ));
        }
        let dir = args.opt_path("dir")?.unwrap_or_else(|| PathBuf::from("."));
        let overwrite = args.bool_or("overwrite", false)?;
        let kind = keystore::KeyKind::parse(&args.str_or("kind", "ed25519")?)?;
        let into_store = args.bool_or("keystore", false)?;

        let (secret, public) = match kind {
            keystore::KeyKind::Ed25519 => {
                let pair: Ed25519KeyPair = self.backend.ed25519_keygen();
                (pair.secret, pair.public)
            }
            keystore::KeyKind::X25519 => {
                let pair = self.backend.x25519_keygen();
                (pair.secret, pair.public)
            }
        };

        if into_store {
            let pass = passphrase(args)?;
            let mut store = if keystore::exists(&ctx.paths.keystore_file) {
                keystore::load(&*self.backend, &ctx.paths.keystore_file, pass.as_ref())?
            } else {
                keystore::Keystore::empty()
            };
            let id = keystore::new_id(&*self.backend);
            store.insert(keystore::Entry {
                id: id.clone(),
                label: label.clone(),
                kind,
                public_key: keys::hex_encode(&public),
                secret_key: keys::hex_encode(&secret),
                created_at: mellivora_core::util::now_rfc3339(),
            })?;
            if !ctx.dry_run {
                ctx.require(Capability::FsWrite)?;
                keystore::save(
                    &*self.backend,
                    &ctx.paths.keystore_file,
                    pass.as_ref(),
                    &store,
                )?;
            }
            return Ok(Report::new(&self.manifest.id)
                .with_summary(format!(
                    "{} {kind} key '{label}' in the keystore",
                    if ctx.dry_run {
                        "would generate"
                    } else {
                        "generated"
                    }
                ))
                .with_data(json!({
                    // `algorithm` is the pre-0.5 spelling of this field; it stays
                    // for one minor per the deprecation policy in
                    // COMPATIBILITY.md, then `kind` is the only name.
                    "algorithm": kind,
                    "kind": kind,
                    "label": label,
                    "id": id,
                    "public_key": keys::hex_encode(&public),
                    "stored": "keystore",
                    "secret_path": Value::Null,
                    "public_path": Value::Null,
                    "keys": store.entries.len(),
                    "dry_run": ctx.dry_run,
                }))
                .with_duration(started.elapsed())
                .sealed());
        }

        let secret_path = dir.join(format!("{label}.{}", keys::SECRET_EXTENSION));
        let public_path = dir.join(format!("{label}.{}", keys::PUBLIC_EXTENSION));
        if !overwrite && (secret_path.exists() || public_path.exists()) {
            return Err(MellivoraError::Config(format!(
                "{} already exists (use overwrite=true to replace it)",
                secret_path.display()
            )));
        }

        if !ctx.dry_run {
            ctx.require(Capability::FsWrite)?;
            match kind {
                keystore::KeyKind::Ed25519 => {
                    let pair = Ed25519KeyPair { secret, public };
                    keys::write_secret(&secret_path, &pair)?;
                    keys::write_public(&public_path, &pair)?;
                }
                keystore::KeyKind::X25519 => {
                    let pair = crate::keys::X25519KeyPair { secret, public };
                    keys::write_x25519_secret(&secret_path, &pair)?;
                    keys::write_x25519_public(&public_path, &pair)?;
                }
            }
        }

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {kind} key '{}' in {}",
                if ctx.dry_run { "would generate" } else { "generated" },
                label,
                dir.display()
            ))
            .with_data(json!({
                "algorithm": kind,
                "kind": kind,
                "label": label,
                "id": Value::Null,
                "public_key": keys::hex_encode(&public),
                "stored": "files",
                "secret_path": if ctx.dry_run { Value::Null } else { Value::String(secret_path.display().to_string()) },
                "public_path": if ctx.dry_run { Value::Null } else { Value::String(public_path.display().to_string()) },
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Sign a file with an Ed25519 secret key.
pub struct Sign {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl Sign {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.sign",
                "Sign a file",
                "Produce a detached Ed25519 signature for a file",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite, Capability::Secrets])
            .with_args([
                input_arg("File to sign"),
                ArgSpec::new("key", ArgKind::Path)
                    .required()
                    .help("Secret key file (<label>.key)"),
                ArgSpec::new("output", ArgKind::Path).help("Signature path (default: <input>.sig)"),
                ArgSpec::new("overwrite", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace the signature file if it exists"),
            ])
            .with_tags(["signature", "ed25519", "integrity"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for Sign {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let input = args.require_path("input")?;
        let key_path = args.require_path("key")?;
        let bytes = read_file(&input)?;
        let secret = keys::decode_secret(
            &fs::read_to_string(&key_path)
                .map_err(|_| MellivoraError::NotFound(key_path.display().to_string()))?,
        )?;

        let target = args.opt_path("output")?.unwrap_or_else(|| {
            let name = input.file_name().unwrap_or_default().to_string_lossy();
            input.with_file_name(format!("{name}.sig"))
        });

        // The signature replaces whatever is at `target`, so the same two guards
        // as encrypt and decrypt apply: never write over the input, and never
        // replace an existing file the caller did not ask to replace.
        ensure_distinct(&input, &target)?;
        ensure_writable(ctx, &target, args.bool_or("overwrite", false)?)?;

        let signature = self.backend.ed25519_sign(&secret, &bytes)?;
        write_file(ctx, &target, &signature)?;

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {} → {}",
                if ctx.dry_run { "would sign" } else { "signed" },
                input.display(),
                target.display()
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "signature": if ctx.dry_run { Value::Null } else { Value::String(target.display().to_string()) },
                "algorithm": keys::ALGORITHM,
                "signature_hex": keys::hex_encode(&signature),
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Verify a detached signature.
pub struct Verify {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl Verify {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.verify",
                "Verify a signature",
                "Check a detached Ed25519 signature against a public key",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead])
            .with_args([
                input_arg("File that was signed"),
                ArgSpec::new("signature", ArgKind::Path)
                    .required()
                    .help("Detached signature file"),
                ArgSpec::new("key", ArgKind::Path)
                    .required()
                    .help("Public key file (<label>.pub)"),
            ])
            .with_tags(["signature", "ed25519", "verification"]),
            backend,
        }
    }
}

impl Tool for Verify {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        let started = Instant::now();

        let input = args.require_path("input")?;
        let signature_path = args.require_path("signature")?;
        let key_path = args.require_path("key")?;

        let bytes = read_file(&input)?;
        let signature_bytes = read_file(&signature_path)?;
        let signature: [u8; 64] = signature_bytes.as_slice().try_into().map_err(|_| {
            MellivoraError::InvalidArgs(format!(
                "{} is not a 64-byte signature",
                signature_path.display()
            ))
        })?;
        let public = keys::decode_public(
            &fs::read_to_string(&key_path)
                .map_err(|_| MellivoraError::NotFound(key_path.display().to_string()))?,
        )?;

        self.backend.ed25519_verify(&public, &bytes, &signature)?;

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!("signature is valid for {}", input.display()))
            .with_data(json!({
                "input": input.display().to_string(),
                "signature": signature_path.display().to_string(),
                "key": key_path.display().to_string(),
                "public_key": keys::hex_encode(&public),
                "algorithm": keys::ALGORITHM,
                "valid": true,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mellivora_core::AppPaths;

    /// Unique per call, so repeated runs and parallel tests cannot collide.
    fn workspace() -> PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let index = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("mellivora-crypto-{}-{index}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn context() -> ToolContext {
        ToolContext::new(AppPaths::under(workspace()))
    }

    fn tool<T>(build: impl FnOnce(Arc<dyn CryptoBackend>) -> T) -> T {
        build(Arc::new(crate::NativeBackend))
    }

    #[test]
    fn encrypts_and_decrypts_a_file() {
        let dir = workspace();
        let input = dir.join("secret.txt");
        fs::write(&input, b"the launch code is 0000").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("passphrase", "correct horse");
        tool(Encrypt::new).run(&context(), &args).expect("encrypt");

        let sealed = dir.join("secret.txt.melv");
        assert!(sealed.exists());
        assert!(!fs::read(&sealed)
            .expect("read")
            .windows(4)
            .any(|w| w == b"laun"));

        let mut decrypt_args = Args::new();
        decrypt_args.insert("input", sealed.display().to_string());
        decrypt_args.insert("passphrase", "correct horse");
        decrypt_args.insert("overwrite", true);
        let report = tool(Decrypt::new)
            .run(&context(), &decrypt_args)
            .expect("decrypt");

        assert_eq!(report.data["algorithm"], Value::from("chacha20-poly1305"));
        assert_eq!(
            fs::read(dir.join("secret.txt")).expect("read"),
            b"the launch code is 0000"
        );
    }

    #[test]
    fn refuses_to_overwrite_an_existing_output() {
        let dir = workspace();
        let input = dir.join("guard.txt");
        fs::write(&input, b"original").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("passphrase", "pass");
        tool(Encrypt::new).run(&context(), &args).expect("first");

        let err = tool(Encrypt::new)
            .run(&context(), &args)
            .expect_err("second");
        assert_eq!(err.code(), "config");

        args.insert("overwrite", true);
        tool(Encrypt::new)
            .run(&context(), &args)
            .expect("overwrite");
    }

    #[test]
    fn wrong_passphrase_is_reported() {
        let dir = workspace();
        let input = dir.join("wrong-pass.txt");
        fs::write(&input, b"data").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("passphrase", "right");
        tool(Encrypt::new).run(&context(), &args).expect("encrypt");

        let out = dir.join("wrong-pass.out");
        let mut decrypt_args = Args::new();
        decrypt_args.insert(
            "input",
            dir.join("wrong-pass.txt.melv").display().to_string(),
        );
        decrypt_args.insert("output", out.display().to_string());
        decrypt_args.insert("passphrase", "wrong");
        let err = tool(Decrypt::new)
            .run(&context(), &decrypt_args)
            .expect_err("must fail");
        assert_eq!(err.code(), "tool");
        // The temporary file is removed: a failed decrypt leaves nothing behind.
        assert!(!out.exists(), "no partial plaintext");
        assert!(
            !out.with_extension("out.tmp").exists(),
            "no leftover temp file"
        );
    }

    #[test]
    fn refuses_an_output_that_is_the_input() {
        let dir = workspace();
        let input = dir.join("same.txt");
        fs::write(&input, b"data").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("output", input.display().to_string());
        args.insert("passphrase", "right");

        let err = tool(Encrypt::new)
            .run(&context(), &args)
            .expect_err("must refuse");
        assert_eq!(err.code(), "invalid_args");
        assert_eq!(fs::read(&input).expect("input intact"), b"data");
    }

    #[test]
    fn passphrase_can_come_from_the_environment() {
        let dir = workspace();
        let input = dir.join("env-pass.txt");
        fs::write(&input, b"data").expect("write");

        let variable = "MELLIVORA_TEST_PASSPHRASE";
        std::env::set_var(variable, "from-the-environment");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("passphrase_env", variable);
        tool(Encrypt::new).run(&context(), &args).expect("encrypt");

        let mut decrypt_args = Args::new();
        decrypt_args.insert("input", dir.join("env-pass.txt.melv").display().to_string());
        decrypt_args.insert("passphrase_env", variable);
        decrypt_args.insert("overwrite", true);
        tool(Decrypt::new)
            .run(&context(), &decrypt_args)
            .expect("decrypt");

        std::env::remove_var(variable);
    }

    #[test]
    fn missing_passphrase_is_an_argument_error() {
        let dir = workspace();
        let input = dir.join("no-pass.txt");
        fs::write(&input, b"data").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        let err = tool(Encrypt::new)
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn dry_run_does_not_write_the_container() {
        let dir = workspace();
        let input = dir.join("dry.txt");
        fs::write(&input, b"data").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("passphrase", "x");
        let report = tool(Encrypt::new)
            .run(&context().with_dry_run(true), &args)
            .expect("dry run");

        assert_eq!(report.data["dry_run"], Value::Bool(true));
        assert!(!dir.join("dry.txt.melv").exists());
    }

    #[test]
    fn inspect_reads_the_header_without_a_passphrase() {
        let dir = workspace();
        let input = dir.join("inspect.txt");
        fs::write(&input, b"data").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("passphrase", "x");
        args.insert("algorithm", "aes256-gcm");
        tool(Encrypt::new).run(&context(), &args).expect("encrypt");

        let mut inspect_args = Args::new();
        inspect_args.insert("input", dir.join("inspect.txt.melv").display().to_string());
        let report = tool(|_| Inspect::new())
            .run(&context(), &inspect_args)
            .expect("inspect");
        assert_eq!(report.data["algorithm"], Value::from("aes256-gcm"));
        assert!(report.data["ciphertext_bytes"].as_u64().unwrap() > 0);
    }

    #[test]
    fn keygen_sign_and_verify_round_trip() {
        let dir = workspace();
        let key_dir = dir.join("keys");

        let mut keygen_args = Args::new();
        keygen_args.insert("label", "signer");
        keygen_args.insert("dir", key_dir.display().to_string());
        let report = tool(KeyGen::new)
            .run(&context(), &keygen_args)
            .expect("keygen");
        assert_eq!(report.data["algorithm"], Value::from("ed25519"));

        let input = dir.join("contract.txt");
        fs::write(&input, b"agreed").expect("write");

        let mut sign_args = Args::new();
        sign_args.insert("input", input.display().to_string());
        sign_args.insert("key", key_dir.join("signer.key").display().to_string());
        let signed = tool(Sign::new).run(&context(), &sign_args).expect("sign");
        assert_eq!(signed.data["signature_hex"].as_str().unwrap().len(), 128);

        let mut verify_args = Args::new();
        verify_args.insert("input", input.display().to_string());
        verify_args.insert(
            "signature",
            dir.join("contract.txt.sig").display().to_string(),
        );
        verify_args.insert("key", key_dir.join("signer.pub").display().to_string());
        let verified = tool(Verify::new)
            .run(&context(), &verify_args)
            .expect("verify");
        assert_eq!(verified.status, mellivora_core::Status::Ok);

        // A changed file must fail verification.
        fs::write(&input, b"agreed, but edited").expect("write");
        let err = tool(Verify::new)
            .run(&context(), &verify_args)
            .expect_err("must fail");
        assert_eq!(err.code(), "tool");
    }

    #[test]
    fn keygen_refuses_to_overwrite_by_default() {
        let dir = workspace();
        let key_dir = dir.join("keys-existing");
        let mut args = Args::new();
        args.insert("label", "twice");
        args.insert("dir", key_dir.display().to_string());
        tool(KeyGen::new).run(&context(), &args).expect("first");
        let err = tool(KeyGen::new)
            .run(&context(), &args)
            .expect_err("second");
        assert_eq!(err.code(), "config");
    }

    #[test]
    fn sign_refuses_to_overwrite_its_input() {
        let dir = workspace();
        let key_dir = dir.join("keys-sign-input");
        let mut keygen_args = Args::new();
        keygen_args.insert("label", "signer");
        keygen_args.insert("dir", key_dir.display().to_string());
        tool(KeyGen::new)
            .run(&context(), &keygen_args)
            .expect("keygen");

        let input = dir.join("keep-me.txt");
        fs::write(&input, b"precious").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("key", key_dir.join("signer.key").display().to_string());
        args.insert("output", input.display().to_string());

        let err = tool(Sign::new)
            .run(&context(), &args)
            .expect_err("must refuse");
        assert_eq!(err.code(), "invalid_args");
        assert_eq!(fs::read(&input).expect("input intact"), b"precious");
    }

    #[test]
    fn sign_refuses_to_replace_an_existing_signature() {
        let dir = workspace();
        let key_dir = dir.join("keys-sign-existing");
        let mut keygen_args = Args::new();
        keygen_args.insert("label", "signer");
        keygen_args.insert("dir", key_dir.display().to_string());
        tool(KeyGen::new)
            .run(&context(), &keygen_args)
            .expect("keygen");

        let input = dir.join("doc.txt");
        fs::write(&input, b"agreed").expect("write");
        let signature = dir.join("doc.sig");
        fs::write(&signature, b"older signature").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("key", key_dir.join("signer.key").display().to_string());
        args.insert("output", signature.display().to_string());

        let err = tool(Sign::new)
            .run(&context(), &args)
            .expect_err("must refuse");
        assert_eq!(err.code(), "config");
        assert_eq!(
            fs::read(&signature).expect("unchanged"),
            b"older signature",
            "the existing signature must survive a refused run"
        );

        args.insert("overwrite", true);
        tool(Sign::new).run(&context(), &args).expect("overwrite");
        assert_eq!(fs::read(&signature).expect("read").len(), 64);
    }

    #[test]
    fn keygen_rejects_path_traversal_labels() {
        let mut args = Args::new();
        args.insert("label", "../escape");
        let err = tool(KeyGen::new)
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn verify_requires_a_64_byte_signature() {
        let dir = workspace();
        let input = dir.join("short-sig.txt");
        fs::write(&input, b"data").expect("write");
        let signature = dir.join("short.sig");
        fs::write(&signature, b"too short").expect("write");

        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("signature", signature.display().to_string());
        args.insert("key", dir.join("missing.pub").display().to_string());
        let err = tool(Verify::new)
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }
}
