//! The sealed key store: one container file holding every key the user keeps.
//!
//! The file is a `.gimlet` container (Argon2id → AEAD, chunked) whose plaintext is
//! a JSON document, so the seal *is* the wrapping: a wrong passphrase fails the
//! AEAD tag before any JSON is parsed, and there is only one format to keep
//! compatible. See `docs/adr/0007-keystore-and-recipients.md`.
//!
//! Secrets never leave this module except through the accessors the tools use to
//! perform an operation; [`EntryView`] is what gets reported, and it has no
//! secret field to leak.

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::Path;

use gimlet_eye_core::{GimletEyeError, Result};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::backend::{AeadAlgorithm, CryptoBackend, KdfParams};
use crate::container;

/// On-disk schema of the keystore document. Part of the frozen surface.
pub const SCHEMA_VERSION: u32 = 1;
/// Bytes of randomness behind an entry id.
const ID_BYTES: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyKind {
    Ed25519,
    X25519,
}

impl KeyKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ed25519 => "ed25519",
            Self::X25519 => "x25519",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "ed25519" | "sign" | "signing" => Ok(Self::Ed25519),
            "x25519" | "encrypt" | "encryption" | "recipient" => Ok(Self::X25519),
            other => Err(GimletEyeError::InvalidArgs(format!(
                "unknown key kind '{other}' (use ed25519 or x25519)"
            ))),
        }
    }
}

impl fmt::Display for KeyKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

#[derive(Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub label: String,
    pub kind: KeyKind,
    pub public_key: String,
    pub secret_key: String,
    pub created_at: String,
}

impl Entry {
    /// 32-byte public key.
    pub fn public_bytes(&self) -> Result<[u8; 32]> {
        crate::keys::hex_decode(&self.public_key)?
            .try_into()
            .map_err(|_| GimletEyeError::InvalidArgs("stored public key is not 32 bytes".into()))
    }

    /// 32-byte secret key. The caller owns the copy and should drop it promptly.
    pub fn secret_bytes(&self) -> Result<Zeroizing<[u8; 32]>> {
        let bytes: [u8; 32] = crate::keys::hex_decode(&self.secret_key)?
            .try_into()
            .map_err(|_| GimletEyeError::InvalidArgs("stored secret key is not 32 bytes".into()))?;
        Ok(Zeroizing::new(bytes))
    }
}

/// Never print key material, even by accident in a log or a panic message.
impl fmt::Debug for Entry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Entry")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("kind", &self.kind)
            .field("public_key", &self.public_key)
            .field("secret_key", &"<redacted>")
            .finish()
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        self.secret_key.zeroize();
    }
}

/// What a report may contain: an entry without its secret.
#[derive(Debug, Clone, Serialize)]
pub struct EntryView {
    pub id: String,
    pub label: String,
    pub kind: KeyKind,
    pub public_key: String,
    pub created_at: String,
}

impl From<&Entry> for EntryView {
    fn from(entry: &Entry) -> Self {
        Self {
            id: entry.id.clone(),
            label: entry.label.clone(),
            kind: entry.kind,
            public_key: entry.public_key.clone(),
            created_at: entry.created_at.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Keystore {
    pub schema_version: u32,
    pub entries: Vec<Entry>,
}

impl Default for Keystore {
    fn default() -> Self {
        Self::empty()
    }
}

impl Keystore {
    pub fn empty() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            entries: Vec::new(),
        }
    }

    pub fn views(&self) -> Vec<EntryView> {
        self.entries.iter().map(EntryView::from).collect()
    }

    /// Resolve a selector: an exact id first, then a unique label.
    pub fn find(&self, selector: &str) -> Result<&Entry> {
        if let Some(entry) = self.entries.iter().find(|entry| entry.id == selector) {
            return Ok(entry);
        }
        let matches: Vec<&Entry> = self
            .entries
            .iter()
            .filter(|entry| entry.label == selector)
            .collect();
        match matches.len() {
            1 => Ok(matches[0]),
            0 => Err(GimletEyeError::NotFound(format!(
                "no key '{selector}' in the keystore"
            ))),
            _ => Err(GimletEyeError::Config(format!(
                "several keys are labelled '{selector}'; use the id instead"
            ))),
        }
    }

    /// Add an entry, refusing a duplicate id or label.
    pub fn insert(&mut self, entry: Entry) -> Result<()> {
        if self.entries.iter().any(|existing| existing.id == entry.id) {
            return Err(GimletEyeError::Internal(
                "generated a key id that already exists".into(),
            ));
        }
        if self
            .entries
            .iter()
            .any(|existing| existing.label == entry.label)
        {
            return Err(GimletEyeError::Config(format!(
                "a key labelled '{}' already exists (choose another label or replace it)",
                entry.label
            )));
        }
        self.entries.push(entry);
        Ok(())
    }

    pub fn remove(&mut self, selector: &str) -> Result<Entry> {
        let id = self.find(selector)?.id.clone();
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .expect("find returned an id from this list");
        Ok(self.entries.remove(index))
    }
}

/// True when a keystore file is present.
pub fn exists(path: &Path) -> bool {
    path.is_file()
}

pub fn new_id(backend: &dyn CryptoBackend) -> String {
    crate::keys::hex_encode(&backend.random_bytes(ID_BYTES))
}

/// Load and unseal the keystore.
pub fn load(backend: &dyn CryptoBackend, path: &Path, passphrase: &[u8]) -> Result<Keystore> {
    if !path.is_file() {
        return Err(GimletEyeError::NotFound(format!(
            "no keystore at {} (create one with crypto.keygen keystore=true)",
            path.display()
        )));
    }
    let sealed = fs::read(path)?;
    let plaintext = container::open(backend, passphrase, &sealed)?;
    let document: Keystore = serde_json::from_slice(&plaintext).map_err(|err| {
        GimletEyeError::Tool(format!(
            "the keystore could not be read after opening: {err}"
        ))
    })?;
    if document.schema_version > SCHEMA_VERSION {
        return Err(GimletEyeError::Unsupported(format!(
            "keystore schema {} is newer than this build understands ({SCHEMA_VERSION})",
            document.schema_version
        )));
    }
    Ok(document)
}

/// Seal and write the keystore, atomically and owner-only.
pub fn save(
    backend: &dyn CryptoBackend,
    path: &Path,
    passphrase: &[u8],
    store: &Keystore,
) -> Result<()> {
    let mut plaintext = Zeroizing::new(
        serde_json::to_vec(store)
            .map_err(|err| GimletEyeError::Internal(format!("keystore encode failed: {err}")))?,
    );
    let mut sealed = Vec::new();
    container::seal_stream(
        backend,
        passphrase,
        AeadAlgorithm::ChaCha20Poly1305,
        KdfParams::default(),
        &plaintext[..],
        &mut sealed,
    )?;
    plaintext.zeroize();

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "keystore".to_string());
    let temp = path.with_file_name(format!("{name}.tmp"));

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let outcome = options.open(&temp).and_then(|mut file| {
        file.write_all(&sealed)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    });
    if let Err(err) = outcome {
        let _ = fs::remove_file(&temp);
        return Err(err.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// An entry for freshly generated key material.
pub fn entry_for(
    backend: &dyn CryptoBackend,
    label: &str,
    kind: KeyKind,
    public: &[u8; 32],
    secret: &[u8; 32],
    created_at: &str,
) -> Entry {
    Entry {
        id: new_id(backend),
        label: label.to_string(),
        kind,
        public_key: crate::keys::hex_encode(public),
        secret_key: crate::keys::hex_encode(secret),
        created_at: created_at.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::NativeBackend;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gimlet-keystore-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir.join("keystore.gimlet")
    }

    fn sample_store(backend: &NativeBackend) -> Keystore {
        let mut store = Keystore::empty();
        let pair = backend.x25519_keygen();
        store
            .insert(entry_for(
                backend,
                "alice",
                KeyKind::X25519,
                &pair.public,
                &pair.secret,
                "2026-10-25T00:00:00Z",
            ))
            .expect("insert");
        store
    }

    #[test]
    fn survives_a_round_trip_and_keeps_its_secret() {
        let path = scratch("roundtrip");
        let backend = NativeBackend;
        let store = sample_store(&backend);
        let expected = store.entries[0].secret_bytes().expect("secret");

        save(&backend, &path, b"correct horse", &store).expect("save");
        let reopened = load(&backend, &path, b"correct horse").expect("load");

        assert_eq!(reopened.schema_version, SCHEMA_VERSION);
        assert_eq!(reopened.entries.len(), 1);
        assert_eq!(reopened.entries[0].label, "alice");
        assert_eq!(reopened.entries[0].kind, KeyKind::X25519);
        assert_eq!(
            reopened.entries[0].secret_bytes().expect("secret"),
            expected
        );

        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn a_wrong_passphrase_fails_closed() {
        let path = scratch("wrongpass");
        let backend = NativeBackend;
        save(&backend, &path, b"correct horse", &sample_store(&backend)).expect("save");

        let error = load(&backend, &path, b"wrong horse").expect_err("must not open");
        assert!(
            error.to_string().contains("wrong passphrase"),
            "unhelpful error: {error}"
        );

        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn the_file_is_owner_only_and_contains_no_plaintext() {
        let path = scratch("perms");
        let backend = NativeBackend;
        let store = sample_store(&backend);
        let secret_hex = store.entries[0].secret_key.clone();
        save(&backend, &path, b"pass", &store).expect("save");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("metadata").permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "the keystore must be owner-only");
        }

        let raw = fs::read(&path).expect("read");
        assert!(!raw.windows(secret_hex.len()).any(|w| w == b"as hex"));
        assert!(
            !String::from_utf8_lossy(&raw).contains(&secret_hex),
            "the secret must not appear in the sealed file"
        );
        assert!(!String::from_utf8_lossy(&raw).contains("alice"));

        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn labels_are_unique_and_selectors_resolve() {
        let backend = NativeBackend;
        let mut store = sample_store(&backend);
        let id = store.entries[0].id.clone();

        assert_eq!(store.find("alice").expect("by label").id, id);
        assert_eq!(store.find(&id).expect("by id").id, id);
        assert_eq!(
            store.find("nobody").expect_err("missing").code(),
            "not_found"
        );

        let duplicate = store.entries[0].secret_bytes().expect("secret");
        let pair = backend.x25519_keygen();
        let entry = entry_for(
            &backend,
            "alice",
            KeyKind::X25519,
            &pair.public,
            &pair.secret,
            "now",
        );
        assert_eq!(store.insert(entry).expect_err("duplicate").code(), "config");
        let _ = duplicate;

        let removed = store.remove("alice").expect("remove");
        assert_eq!(removed.id, id);
        assert!(store.entries.is_empty());
    }

    #[test]
    fn a_newer_schema_is_refused_rather_than_guessed() {
        let path = scratch("schema");
        let backend = NativeBackend;
        let mut store = sample_store(&backend);
        store.schema_version = SCHEMA_VERSION + 1;
        save(&backend, &path, b"pass", &store).expect("save");

        let error = load(&backend, &path, b"pass").expect_err("newer schema");
        assert_eq!(error.code(), "unsupported");

        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn debug_does_not_print_the_secret() {
        let backend = NativeBackend;
        let store = sample_store(&backend);
        let secret = store.entries[0].secret_key.clone();
        let printed = format!("{:?}", store);
        assert!(!printed.contains(&secret), "Debug leaked the secret key");
        assert!(printed.contains("redacted"));
    }

    #[test]
    fn a_missing_store_is_a_clear_error_not_an_empty_one() {
        let path = scratch("missing");
        let error = load(&NativeBackend, &path, b"pass").expect_err("missing");
        assert_eq!(error.code(), "not_found");
        assert!(error.to_string().contains("crypto.keygen"));
    }
}
