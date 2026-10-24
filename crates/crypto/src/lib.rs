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
mod keys;
mod operations;
mod passgen;

pub use backend::{AeadAlgorithm, CryptoBackend, KdfParams, NativeBackend};
pub use container::{
    inspect, open, open_stream, seal, seal_stream, ContainerHeader, StreamStats, CHUNK_SIZE,
    EXTENSION as CONTAINER_EXTENSION, HEADER_LEN, MAGIC, VERSION, VERSION_STREAMING,
};
pub use hash::Sha256;
pub use keys::{Ed25519KeyPair, PUBLIC_EXTENSION, SECRET_EXTENSION};
pub use operations::{Decrypt, Encrypt, Inspect, KeyGen, Sign, Verify};
pub use passgen::PassGen;

use std::sync::Arc;

use mellivora_core::{Result, Tool};

/// Build the tool set backed by the native engine.
pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    tools_with(Arc::new(NativeBackend))
}

pub fn tools_with(backend: Arc<dyn CryptoBackend>) -> Result<Vec<Arc<dyn Tool>>> {
    Ok(vec![
        Arc::new(PassGen::new(Arc::clone(&backend))),
        Arc::new(Sha256::new(Arc::clone(&backend))),
        Arc::new(Encrypt::new(Arc::clone(&backend))),
        Arc::new(Decrypt::new(Arc::clone(&backend))),
        Arc::new(Inspect::new()),
        Arc::new(KeyGen::new(Arc::clone(&backend))),
        Arc::new(Sign::new(Arc::clone(&backend))),
        Arc::new(Verify::new(backend)),
    ])
}
