//! Cryptography module.
//!
//! The scaffold ships the seal that DarkStar (Zayfer Vault) plugs into: a
//! [`CryptoBackend`] trait plus the operations that do not need the full engine
//! (OS randomness, hashing, password generation). AEAD, signatures, key
//! management, and the HBZF container land in the `darkstar` integration phase
//! behind the same trait, so tools and surfaces never change.

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
