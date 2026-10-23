//! Cryptography module.
//!
//! Everything here talks to a [`CryptoBackend`]. The toolkit ships an
//! operating-system backend (randomness, SHA-256, password generation); the
//! authenticated-encryption engine, signatures, key management, and the
//! streaming container slot in behind the same trait, so tools and surfaces
//! never change as the engine grows.

mod backend;
mod hash;
mod passgen;

pub use backend::{CryptoBackend, OsBackend};
pub use hash::Sha256;
pub use passgen::PassGen;

use std::sync::Arc;

use mellivora_core::{Result, Tool};

/// Build the tool set backed by the operating system's CSPRNG.
pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    tools_with(Arc::new(OsBackend))
}

pub fn tools_with(backend: Arc<dyn CryptoBackend>) -> Result<Vec<Arc<dyn Tool>>> {
    Ok(vec![
        Arc::new(PassGen::new(Arc::clone(&backend))),
        Arc::new(Sha256::new(Arc::clone(&backend))),
    ])
}
