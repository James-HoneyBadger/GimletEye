//! Tools over the sealed keystore: list, import, export, rotate.
//!
//! Every one of them reports [`keystore::EntryView`] or counts. A secret never
//! reaches `data`, the summary, the body, or the audit trail - the only tool
//! that writes one out writes it to a file the user named, with mode 0600.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use gimlet_eye_core::{
    util::now_rfc3339, ArgKind, ArgSpec, Args, Capability, Category, GimletEyeError, Report,
    Result, Tool, ToolContext, ToolManifest,
};
use serde_json::{json, Value};

use crate::backend::CryptoBackend;
use crate::keys;
use crate::keystore::{self, KeyKind, Keystore};
use crate::operations::{ensure_writable, passphrase, passphrase_args};

fn keystore_path(ctx: &ToolContext) -> PathBuf {
    ctx.paths.keystore_file.clone()
}

fn load(ctx: &ToolContext, backend: &dyn CryptoBackend, pass: &[u8]) -> Result<Keystore> {
    keystore::load(backend, &keystore_path(ctx), pass)
}

fn persist(
    ctx: &ToolContext,
    backend: &dyn CryptoBackend,
    pass: &[u8],
    store: &Keystore,
) -> Result<()> {
    if ctx.dry_run {
        return Ok(());
    }
    keystore::save(backend, &keystore_path(ctx), pass, store)
}

/// Passphrase argument shared by the keystore tools, plus the new one for
/// rotation.
fn new_passphrase_args() -> [ArgSpec; 2] {
    [
        ArgSpec::new("new_passphrase_env", ArgKind::String)
            .help("Environment variable holding the new passphrase (preferred)"),
        ArgSpec::new("new_passphrase", ArgKind::String)
            .help("New passphrase inline; visible to other local users and shell history"),
    ]
}

/// List the public half of every key in the keystore.
pub struct KeyList {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl KeyList {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.key-list",
                "List keys",
                "List the keys in the sealed keystore: id, label, kind, and public key",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::Secrets])
            .with_args(passphrase_args())
            .with_tags(["keys", "keystore", "inventory"]),
            backend,
        }
    }
}

impl Tool for KeyList {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();
        let pass = passphrase(args)?;
        let store = load(ctx, &*self.backend, pass.as_ref())?;
        let views = store.views();

        let signing = views.iter().filter(|v| v.kind == KeyKind::Ed25519).count();
        let recipients = views.len() - signing;

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} key(s): {signing} signing, {recipients} recipient(s)",
                views.len()
            ))
            .with_data(json!({
                "path": keystore_path(ctx).display().to_string(),
                "count": views.len(),
                "keys": views,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Add a key from a key file.
pub struct KeyImport {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl KeyImport {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.key-import",
                "Import a key",
                "Add a key from a key file into the sealed keystore",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite, Capability::Secrets])
            .with_args([
                ArgSpec::new("key", ArgKind::Path)
                    .required()
                    .help("Key file to import (<label>.key or <label>.pub)"),
                ArgSpec::new("label", ArgKind::String)
                    .help("Name for the key (default: the file's stem)"),
                ArgSpec::new("kind", ArgKind::String)
                    .help("ed25519 or x25519 (default: whatever the file declares)"),
                ArgSpec::new("public_only", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Import only the public half, e.g. someone else's recipient key"),
                ArgSpec::new("replace", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace an existing entry with the same label"),
                passphrase_args()[0].clone(),
                passphrase_args()[1].clone(),
            ])
            .with_tags(["keys", "keystore", "import"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for KeyImport {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let source = args.require_path("key")?;
        let text = String::from_utf8(crate::operations::read_file(&source)?)
            .map_err(|_| GimletEyeError::InvalidArgs("key file is not text".into()))?;

        let declared = keys::algorithm_of(&text)?;
        let kind = match args.opt_str("kind")? {
            Some(value) => KeyKind::parse(&value)?,
            None => KeyKind::parse(&declared)?,
        };
        if KeyKind::parse(&declared)? != kind {
            return Err(GimletEyeError::InvalidArgs(format!(
                "the file holds a {declared} key, not {kind}"
            )));
        }

        let label = match args.opt_str("label")? {
            Some(value) => value,
            None => source
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .ok_or_else(|| GimletEyeError::InvalidArgs("provide a label".into()))?,
        };
        let public_only = args.bool_or("public_only", false)?;

        // A secret import re-derives the public half instead of trusting the
        // file, so a corrupted or edited key file cannot put a key in the store
        // that will silently fail every signature.
        let (public, secret) = match kind {
            KeyKind::Ed25519 => {
                let public = keys::decode_public(&text)?;
                if public_only {
                    (public, None)
                } else {
                    let secret = keys::decode_secret(&text)?;
                    if self.backend.ed25519_public(&secret) != public {
                        return Err(GimletEyeError::InvalidArgs(
                            "the key file's public key is not the one its secret produces".into(),
                        ));
                    }
                    (public, Some(secret))
                }
            }
            KeyKind::X25519 => {
                let public = keys::decode_x25519_public(&text)?;
                if public_only {
                    (public, None)
                } else {
                    let secret = keys::decode_x25519_secret(&text)?;
                    if self.backend.x25519_public(&secret) != public {
                        return Err(GimletEyeError::InvalidArgs(
                            "the key file's public key is not the one its secret produces".into(),
                        ));
                    }
                    (public, Some(secret))
                }
            }
        };

        let pass = passphrase(args)?;
        let mut store = if keystore::exists(&keystore_path(ctx)) {
            load(ctx, &*self.backend, pass.as_ref())?
        } else {
            Keystore::empty()
        };

        if args.bool_or("replace", false)? && store.find(&label).is_ok() {
            store.remove(&label)?;
        }

        let secret_hex = match secret {
            Some(bytes) => keys::hex_encode(&bytes),
            None => String::new(),
        };
        let id = keystore::new_id(&*self.backend);
        let entry = keystore::Entry {
            id: id.clone(),
            label: label.clone(),
            kind,
            public_key: keys::hex_encode(&public),
            secret_key: secret_hex,
            created_at: now_rfc3339(),
        };
        store.insert(entry)?;
        persist(ctx, &*self.backend, pass.as_ref(), &store)?;

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {kind} key '{label}' ({})",
                if ctx.dry_run {
                    "would import"
                } else {
                    "imported"
                },
                if public_only {
                    "public only"
                } else {
                    "with secret"
                }
            ))
            .with_data(json!({
                "id": id,
                "label": label,
                "kind": kind,
                "public_key": keys::hex_encode(&public),
                "has_secret": !public_only,
                "keys": store.entries.len(),
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Write a key back out as a key file.
pub struct KeyExport {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl KeyExport {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.key-export",
                "Export a key",
                "Write a key from the keystore to a key file; the secret needs an explicit flag",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsWrite, Capability::Secrets])
            .with_args([
                ArgSpec::new("selector", ArgKind::String)
                    .required()
                    .help("Key id or label"),
                ArgSpec::new("output", ArgKind::Path)
                    .help("Destination (default: <label>.pub, or <label>.key for a secret)"),
                ArgSpec::new("secret", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Export the secret half, not just the public key"),
                ArgSpec::new("overwrite", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace the destination if it exists"),
                passphrase_args()[0].clone(),
                passphrase_args()[1].clone(),
            ])
            .with_tags(["keys", "keystore", "export"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for KeyExport {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let selector = args.require_str("selector")?;
        let with_secret = args.bool_or("secret", false)?;
        let pass = passphrase(args)?;
        let store = load(ctx, &*self.backend, pass.as_ref())?;
        let entry = store.find(&selector)?;

        let extension = if with_secret {
            keys::SECRET_EXTENSION
        } else {
            keys::PUBLIC_EXTENSION
        };
        let target = match args.opt_path("output")? {
            Some(path) => path,
            None => PathBuf::from(format!("{}.{extension}", entry.label)),
        };
        ensure_writable(ctx, &target, args.bool_or("overwrite", false)?)?;

        if with_secret && entry.secret_key.is_empty() {
            return Err(GimletEyeError::Config(format!(
                "key '{}' was imported without its secret, so it cannot be exported",
                entry.label
            )));
        }

        let public = entry.public_bytes()?;
        let secret: Option<[u8; 32]> = if with_secret {
            Some(*entry.secret_bytes()?)
        } else {
            None
        };
        let text = match (entry.kind, secret) {
            (KeyKind::Ed25519, Some(secret)) => {
                keys::encode_secret(&keys::Ed25519KeyPair { secret, public })
            }
            (KeyKind::Ed25519, None) => keys::encode_public(&keys::Ed25519KeyPair {
                secret: [0u8; 32],
                public,
            }),
            (KeyKind::X25519, Some(secret)) => {
                keys::encode_x25519_secret(&keys::X25519KeyPair { secret, public })
            }
            (KeyKind::X25519, None) => keys::encode_x25519_public(&keys::X25519KeyPair {
                secret: [0u8; 32],
                public,
            }),
        };

        if !ctx.dry_run {
            ctx.require(Capability::FsWrite)?;
            crate::operations::write_file(ctx, &target, text.as_bytes())?;
            if with_secret {
                restrict_mode(&target)?;
            }
        }

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {} key '{}{}' → {}",
                if ctx.dry_run { "would export" } else { "exported" },
                entry.kind,
                entry.label,
                if with_secret { " (secret)" } else { "" },
                target.display()
            ))
            .with_data(json!({
                "label": entry.label,
                "kind": entry.kind,
                "public_key": entry.public_key,
                "output": if ctx.dry_run { Value::Null } else { Value::String(target.display().to_string()) },
                "secret": with_secret,
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Re-seal the keystore under a new passphrase.
pub struct KeyRotate {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl KeyRotate {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.key-rotate",
                "Rotate the keystore passphrase",
                "Re-seal every key under a new passphrase; key material is not regenerated",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite, Capability::Secrets])
            .with_args(
                passphrase_args()
                    .into_iter()
                    .chain(new_passphrase_args())
                    .collect::<Vec<_>>(),
            )
            .with_tags(["keys", "keystore", "passphrase", "rotation"])
            .mutating(),
            backend,
        }
    }
}

impl Tool for KeyRotate {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let current = passphrase(args)?;
        let next = if let Some(variable) = args.opt_str("new_passphrase_env")? {
            let value = std::env::var(&variable).map_err(|_| {
                GimletEyeError::InvalidArgs(format!("environment variable '{variable}' is not set"))
            })?;
            zeroize::Zeroizing::new(value.into_bytes())
        } else if let Some(value) = args.opt_str("new_passphrase")? {
            zeroize::Zeroizing::new(value.into_bytes())
        } else {
            return Err(GimletEyeError::InvalidArgs(
                "provide 'new_passphrase_env' (preferred) or 'new_passphrase'".into(),
            ));
        };
        if next.is_empty() {
            return Err(GimletEyeError::InvalidArgs(
                "the new passphrase is empty".into(),
            ));
        }
        if *next == *current {
            return Err(GimletEyeError::InvalidArgs(
                "the new passphrase is the current one".into(),
            ));
        }

        let store = load(ctx, &*self.backend, current.as_ref())?;
        let count = store.entries.len();
        persist(ctx, &*self.backend, next.as_ref(), &store)?;

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {count} key(s) re-sealed under a new passphrase (key material unchanged)",
                if ctx.dry_run {
                    "would rotate"
                } else {
                    "rotated"
                }
            ))
            .with_data(json!({
                "path": keystore_path(ctx).display().to_string(),
                "keys": count,
                "scope": "seal",
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

fn restrict_mode(path: &Path) -> Result<()> {
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
