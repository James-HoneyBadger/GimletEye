//! The `.melv` container: one encrypted file, self-describing, authenticated.
//!
//! ```text
//! 0..4    magic "MELV"
//! 4       format version (1)
//! 5       cipher id      (1 = AES-256-GCM, 2 = ChaCha20-Poly1305)
//! 6       kdf id         (1 = Argon2id)
//! 7       reserved (0)
//! 8..17   kdf parameters (m_cost u32le, t_cost u32le, p_cost u8)
//! 17..21  reserved (0)
//! 21..37  salt (16)
//! 37..49  nonce (12)
//! 49..    ciphertext with authentication tag
//! ```
//!
//! The whole header is passed as associated data, so altering the cipher, the
//! KDF parameters, or the salt causes decryption to fail instead of silently
//! weakening the file. Parameter bounds are validated *before* key derivation so
//! a crafted header cannot demand gigabytes of memory.

use mellivora_core::{MellivoraError, Result};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::backend::{AeadAlgorithm, CryptoBackend, KdfParams};
use crate::keys::hex_encode;

pub const MAGIC: [u8; 4] = *b"MELV";
pub const VERSION: u8 = 1;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const HEADER_LEN: usize = 49;
pub const EXTENSION: &str = "melv";

const KDF_ARGON2ID: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContainerHeader {
    pub version: u8,
    pub algorithm: AeadAlgorithm,
    pub kdf: KdfParams,
    pub salt_hex: String,
}

/// Encrypt `plaintext` into a complete container.
pub fn seal(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    algorithm: AeadAlgorithm,
    params: KdfParams,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    params.validate()?;

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&backend.random_bytes(SALT_LEN));
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&backend.random_bytes(NONCE_LEN));

    let header = build_header(algorithm, params, &salt, &nonce);
    let key = backend.derive_key(passphrase, &salt, params)?;
    let ciphertext = backend.aead_encrypt(algorithm, &key, &nonce, plaintext, &header)?;

    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a complete container.
pub fn open(
    backend: &dyn CryptoBackend,
    passphrase: &[u8],
    bytes: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let header = parse_header(bytes)?;
    let key = backend.derive_key(passphrase, &header_salt(bytes)?, header.kdf)?;
    backend.aead_decrypt(
        header.algorithm,
        &key,
        &header_nonce(bytes)?,
        &bytes[HEADER_LEN..],
        &bytes[..HEADER_LEN],
    )
}

/// Read the header without the passphrase.
pub fn inspect(bytes: &[u8]) -> Result<ContainerHeader> {
    parse_header(bytes)
}

fn build_header(
    algorithm: AeadAlgorithm,
    params: KdfParams,
    salt: &[u8; SALT_LEN],
    nonce: &[u8; NONCE_LEN],
) -> [u8; HEADER_LEN] {
    let mut header = [0u8; HEADER_LEN];
    header[0..4].copy_from_slice(&MAGIC);
    header[4] = VERSION;
    header[5] = algorithm.to_wire();
    header[6] = KDF_ARGON2ID;
    header[7] = 0;
    header[8..17].copy_from_slice(&params.to_wire());
    header[17..21].copy_from_slice(&[0, 0, 0, 0]);
    header[21..37].copy_from_slice(salt);
    header[37..49].copy_from_slice(nonce);
    header
}

fn parse_header(bytes: &[u8]) -> Result<ContainerHeader> {
    if bytes.len() < HEADER_LEN {
        return Err(MellivoraError::InvalidArgs(
            "not an encrypted container (file is too short)".into(),
        ));
    }
    if bytes[0..4] != MAGIC {
        return Err(MellivoraError::InvalidArgs(
            "not an encrypted container (bad magic bytes)".into(),
        ));
    }
    if bytes[4] != VERSION {
        return Err(MellivoraError::Unsupported(format!(
            "container format version {} is not supported",
            bytes[4]
        )));
    }
    if bytes[6] != KDF_ARGON2ID {
        return Err(MellivoraError::Unsupported(format!(
            "container uses unknown key-derivation id {}",
            bytes[6]
        )));
    }
    // Reserved bytes must be zero: a non-zero value means a feature this build
    // does not understand, which must not be silently ignored.
    if bytes[7] != 0 || bytes[17..21] != [0, 0, 0, 0] {
        return Err(MellivoraError::Unsupported(
            "container uses features this build does not support".into(),
        ));
    }

    Ok(ContainerHeader {
        version: bytes[4],
        algorithm: AeadAlgorithm::from_wire(bytes[5])?,
        kdf: KdfParams::from_wire(&bytes[8..17])?,
        salt_hex: hex_encode(&bytes[21..37]),
    })
}

fn header_salt(bytes: &[u8]) -> Result<[u8; SALT_LEN]> {
    bytes
        .get(21..37)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| MellivoraError::InvalidArgs("container header is truncated".into()))
}

fn header_nonce(bytes: &[u8]) -> Result<[u8; NONCE_LEN]> {
    bytes
        .get(37..49)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| MellivoraError::InvalidArgs("container header is truncated".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::NativeBackend;

    fn cheap_params() -> KdfParams {
        KdfParams {
            m_cost_kib: 64,
            t_cost: 1,
            p_cost: 1,
        }
    }

    #[test]
    fn round_trips_both_ciphers() {
        for algorithm in [AeadAlgorithm::Aes256Gcm, AeadAlgorithm::ChaCha20Poly1305] {
            let sealed = seal(
                &NativeBackend,
                b"hunter2",
                algorithm,
                cheap_params(),
                b"top secret",
            )
            .expect("seal");
            assert_eq!(&sealed[0..4], &MAGIC);

            let opened = open(&NativeBackend, b"hunter2", &sealed).expect("open");
            assert_eq!(opened.as_slice(), b"top secret");

            let header = inspect(&sealed).expect("inspect");
            assert_eq!(header.algorithm, algorithm);
            assert_eq!(header.version, VERSION);
        }
    }

    #[test]
    fn empty_plaintext_round_trips() {
        let sealed = seal(
            &NativeBackend,
            b"pass",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            b"",
        )
        .expect("seal");
        assert_eq!(
            open(&NativeBackend, b"pass", &sealed)
                .expect("open")
                .as_slice(),
            b""
        );
    }

    #[test]
    fn wrong_passphrase_fails() {
        let sealed = seal(
            &NativeBackend,
            b"correct",
            AeadAlgorithm::Aes256Gcm,
            cheap_params(),
            b"data",
        )
        .expect("seal");
        let err = open(&NativeBackend, b"wrong", &sealed).expect_err("must fail");
        assert_eq!(err.code(), "tool");
        assert!(err.to_string().contains("wrong passphrase"));
    }

    #[test]
    fn tampering_with_the_header_is_detected() {
        // Swap the cipher id: the derived key is the same, but the header is
        // authenticated, so decryption must fail.
        let sealed = seal(
            &NativeBackend,
            b"pass",
            AeadAlgorithm::ChaCha20Poly1305,
            cheap_params(),
            b"data",
        )
        .expect("seal");

        let mut tampered = sealed.clone();
        tampered[5] = AeadAlgorithm::Aes256Gcm.to_wire();
        assert!(open(&NativeBackend, b"pass", &tampered).is_err());

        // Weakening the KDF parameters must also fail.
        let mut weakened = sealed.clone();
        weakened[8] = 8; // m_cost = 8 KiB
        assert!(open(&NativeBackend, b"pass", &weakened).is_err());
    }

    #[test]
    fn rejects_non_containers_and_truncation() {
        assert_eq!(
            open(&NativeBackend, b"x", b"hello")
                .expect_err("short")
                .code(),
            "invalid_args"
        );

        let mut wrong_magic = vec![0u8; HEADER_LEN];
        wrong_magic[0..4].copy_from_slice(b"NOPE");
        assert_eq!(
            inspect(&wrong_magic).expect_err("magic").code(),
            "invalid_args"
        );

        let sealed = seal(
            &NativeBackend,
            b"pass",
            AeadAlgorithm::Aes256Gcm,
            cheap_params(),
            b"data",
        )
        .expect("seal");
        assert!(open(&NativeBackend, b"pass", &sealed[..HEADER_LEN - 1]).is_err());

        let truncated = &sealed[..HEADER_LEN + 2];
        assert!(open(&NativeBackend, b"pass", truncated).is_err());
    }

    #[test]
    fn rejects_absurd_parameters_before_deriving() {
        let mut bytes = vec![0u8; HEADER_LEN + 1];
        bytes[0..4].copy_from_slice(&MAGIC);
        bytes[4] = VERSION;
        bytes[5] = 1;
        bytes[6] = KDF_ARGON2ID;
        // m_cost = 4 GiB would be a denial of service if we tried it.
        bytes[8..12].copy_from_slice(&4_000_000u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&2u32.to_le_bytes());
        bytes[16] = 1;
        let err = inspect(&bytes).expect_err("must reject");
        assert_eq!(err.code(), "unsupported");
    }

    #[test]
    fn header_is_deterministic_for_the_same_inputs() {
        let salt = [1u8; SALT_LEN];
        let nonce = [2u8; NONCE_LEN];
        let a = build_header(AeadAlgorithm::Aes256Gcm, cheap_params(), &salt, &nonce);
        let b = build_header(AeadAlgorithm::Aes256Gcm, cheap_params(), &salt, &nonce);
        assert_eq!(a, b);
        assert_eq!(a.len(), HEADER_LEN);
    }
}
