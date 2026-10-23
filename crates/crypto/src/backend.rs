use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256 as Sha2};

/// The seam through which a cryptographic engine is attached.
///
/// A native engine implements this trait directly; [`OsBackend`] is the
/// built-in implementation, covering randomness, hashing, and password
/// generation without an external dependency.
pub trait CryptoBackend: Send + Sync {
    /// Short backend identifier shown by `mellivora doctor`.
    fn name(&self) -> &'static str;

    /// Declared capabilities, e.g. `hash:sha256`.
    fn capabilities(&self) -> Vec<String>;

    /// Cryptographically secure random bytes.
    fn random_bytes(&self, length: usize) -> Vec<u8>;

    /// Lowercase hex SHA-256 digest.
    fn sha256_hex(&self, data: &[u8]) -> String;
}

/// Operating-system CSPRNG plus SHA-256 from the RustCrypto family.
#[derive(Debug, Default, Clone, Copy)]
pub struct OsBackend;

impl CryptoBackend for OsBackend {
    fn name(&self) -> &'static str {
        "os"
    }

    fn capabilities(&self) -> Vec<String> {
        vec!["rng:os".to_string(), "hash:sha256".to_string()]
    }

    fn random_bytes(&self, length: usize) -> Vec<u8> {
        let mut buffer = vec![0u8; length];
        OsRng.fill_bytes(&mut buffer);
        buffer
    }

    fn sha256_hex(&self, data: &[u8]) -> String {
        let digest = Sha2::digest(data);
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        let digest = OsBackend.sha256_hex(b"abc");
        assert_eq!(
            digest,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn random_bytes_are_the_right_length_and_not_constant() {
        let first = OsBackend.random_bytes(32);
        let second = OsBackend.random_bytes(32);
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
    }
}
