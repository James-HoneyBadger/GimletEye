//! Cryptography module.
//!
//! Everything here talks to a [`CryptoBackend`]. The toolkit's native backend
//! covers authenticated encryption (AES-256-GCM, ChaCha20-Poly1305), Argon2id
//! key derivation, Ed25519 signatures, SHA-256, and password generation. An
//! alternative engine (a hardware token, a validated module) implements the same
//! trait, and no tool or surface changes.

mod backend;
mod container;
mod hash;
pub mod keyops;
mod keys;
pub mod keystore;
#[cfg(feature = "openpgp")]
mod openpgp;
mod operations;
mod passgen;

pub use backend::{AeadAlgorithm, CryptoBackend, KdfParams, NativeBackend};
pub use container::{
    has_magic, inspect, open, open_for_recipient, open_stream, seal, seal_for_recipients,
    seal_stream, ContainerHeader, Kdf, StreamStats, CHUNK_SIZE, EXTENSION as CONTAINER_EXTENSION,
    HEADER_LEN, LEGACY_EXTENSION as LEGACY_CONTAINER_EXTENSION, LEGACY_MAGIC, MAGIC,
    MAX_RECIPIENTS, NONCE_LEN, RECIPIENT_ENTRY_LEN, RECIPIENT_PREFIX_LEN, VERSION,
    VERSION_RECIPIENT, VERSION_STREAMING,
};
pub use hash::Sha256;
pub use keyops::{KeyExport, KeyImport, KeyList, KeyRotate};
pub use keys::{
    Ed25519KeyPair, X25519KeyPair, PUBLIC_EXTENSION, SECRET_EXTENSION, X25519_ALGORITHM,
};
#[cfg(feature = "openpgp")]
pub use openpgp::{GpgEncrypt, GpgVerify};
pub use operations::{Decrypt, Encrypt, Inspect, KeyGen, Sign, Verify};
pub use passgen::PassGen;

use std::sync::Arc;

use gimlet_eye_core::{Result, Tool};

/// Build the tool set backed by the native engine.
pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    tools_with(Arc::new(NativeBackend))
}

pub fn tools_with(backend: Arc<dyn CryptoBackend>) -> Result<Vec<Arc<dyn Tool>>> {
    let engine = Arc::clone(&backend);
    #[allow(unused_mut)]
    let mut tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(PassGen::new(Arc::clone(&backend))),
        Arc::new(Sha256::new(Arc::clone(&backend))),
        Arc::new(Encrypt::new(Arc::clone(&backend))),
        Arc::new(Decrypt::new(Arc::clone(&backend))),
        Arc::new(Inspect::new()),
        Arc::new(KeyGen::new(Arc::clone(&backend))),
        Arc::new(Sign::new(Arc::clone(&backend))),
        Arc::new(Verify::new(backend)),
        Arc::new(KeyList::new(Arc::clone(&engine))),
        Arc::new(KeyImport::new(Arc::clone(&engine))),
        Arc::new(KeyExport::new(Arc::clone(&engine))),
        Arc::new(KeyRotate::new(engine)),
    ];
    // The OpenPGP tools drive the system gpg rather than a backend, so they are
    // added here instead of taking a handle they would never use.
    #[cfg(feature = "openpgp")]
    tools.extend(crate::openpgp::tools()?);
    Ok(tools)
}
