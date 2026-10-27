use std::fmt;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChaChaNonce};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use gimlet_eye_core::{GimletEyeError, Result};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256 as Sha2};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::Zeroizing;

use crate::keys::{Ed25519KeyPair, X25519KeyPair};

/// Authenticated encryption algorithms the engine can provide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AeadAlgorithm {
    #[serde(rename = "aes256-gcm")]
    Aes256Gcm,
    #[serde(rename = "chacha20-poly1305")]
    ChaCha20Poly1305,
}

impl AeadAlgorithm {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Aes256Gcm => "aes256-gcm",
            Self::ChaCha20Poly1305 => "chacha20-poly1305",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "aes256-gcm" | "aes-256-gcm" | "aes" => Ok(Self::Aes256Gcm),
            "chacha20-poly1305" | "chacha20poly1305" | "chacha" => Ok(Self::ChaCha20Poly1305),
            other => Err(GimletEyeError::InvalidArgs(format!(
                "unknown algorithm '{other}' (use aes256-gcm or chacha20-poly1305)"
            ))),
        }
    }

    /// Stable on-disk identifier. These values are part of the container format.
    pub fn to_wire(self) -> u8 {
        match self {
            Self::Aes256Gcm => 1,
            Self::ChaCha20Poly1305 => 2,
        }
    }

    pub fn from_wire(value: u8) -> Result<Self> {
        match value {
            1 => Ok(Self::Aes256Gcm),
            2 => Ok(Self::ChaCha20Poly1305),
            other => Err(GimletEyeError::Unsupported(format!(
                "container uses unknown cipher id {other}"
            ))),
        }
    }
}

impl fmt::Display for AeadAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

const MIN_M_COST_KIB: u32 = 8;
const MAX_M_COST_KIB: u32 = 1_048_576;
const MAX_T_COST: u32 = 16;
const MAX_P_COST: u8 = 8;

/// Argon2id parameters. Stored in the container header and used as AAD, so a
/// tampered header fails authentication rather than silently weakening the KDF.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u8,
}

impl Default for KdfParams {
    /// OWASP's Argon2id recommendation: 19 MiB, two iterations, one lane.
    fn default() -> Self {
        Self {
            m_cost_kib: 19_456,
            t_cost: 2,
            p_cost: 1,
        }
    }
}

impl KdfParams {
    pub fn validate(&self) -> Result<()> {
        if !(MIN_M_COST_KIB..=MAX_M_COST_KIB).contains(&self.m_cost_kib) {
            return Err(GimletEyeError::Unsupported(format!(
                "container memory cost {} KiB is outside the accepted range",
                self.m_cost_kib
            )));
        }
        if self.t_cost == 0 || self.t_cost > MAX_T_COST {
            return Err(GimletEyeError::Unsupported(format!(
                "container time cost {} is outside the accepted range",
                self.t_cost
            )));
        }
        if self.p_cost == 0 || self.p_cost > MAX_P_COST {
            return Err(GimletEyeError::Unsupported(format!(
                "container parallelism {} is outside the accepted range",
                self.p_cost
            )));
        }
        Ok(())
    }

    pub fn to_wire(self) -> [u8; 9] {
        let mut out = [0u8; 9];
        out[0..4].copy_from_slice(&self.m_cost_kib.to_le_bytes());
        out[4..8].copy_from_slice(&self.t_cost.to_le_bytes());
        out[8] = self.p_cost;
        out
    }

    pub fn from_wire(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 9 {
            return Err(GimletEyeError::Unsupported(
                "container header is truncated".into(),
            ));
        }
        let params = Self {
            m_cost_kib: u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            t_cost: u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            p_cost: bytes[8],
        };
        params.validate()?;
        Ok(params)
    }
}

/// The seam through which a cryptographic engine is attached.
///
/// [`NativeBackend`] is the built-in implementation. An alternative engine (for
/// example one backed by a hardware token or a FIPS-validated module) implements
/// the same trait, and no tool or surface changes.
pub trait CryptoBackend: Send + Sync {
    fn name(&self) -> &'static str;

    /// Declared capabilities, e.g. `cipher:aes256-gcm`.
    fn capabilities(&self) -> Vec<String>;

    fn random_bytes(&self, length: usize) -> Vec<u8>;

    fn sha256_hex(&self, data: &[u8]) -> String;

    /// Derive a 256-bit key from a passphrase. The caller owns zeroization.
    fn derive_key(
        &self,
        passphrase: &[u8],
        salt: &[u8; 16],
        params: KdfParams,
    ) -> Result<Zeroizing<[u8; 32]>>;

    /// Encrypt with a caller-supplied nonce. Never reuse a nonce with a key;
    /// the container layer generates one per file.
    fn aead_encrypt(
        &self,
        algorithm: AeadAlgorithm,
        key: &[u8; 32],
        nonce: &[u8; 12],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>>;

    fn aead_decrypt(
        &self,
        algorithm: AeadAlgorithm,
        key: &[u8; 32],
        nonce: &[u8; 12],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>>;

    fn ed25519_keygen(&self) -> Ed25519KeyPair;

    fn ed25519_sign(&self, secret: &[u8; 32], message: &[u8]) -> Result<[u8; 64]>;

    fn ed25519_verify(&self, public: &[u8; 32], message: &[u8], signature: &[u8; 64])
        -> Result<()>;

    fn x25519_keygen(&self) -> X25519KeyPair;

    /// The public half of an Ed25519 secret, so an imported key file can be
    /// checked against its own secret instead of trusted.
    fn ed25519_public(&self, secret: &[u8; 32]) -> [u8; 32];

    /// The public half of an X25519 secret, so a container can find its
    /// recipient entry without trusting a public key stored next to the secret.
    fn x25519_public(&self, secret: &[u8; 32]) -> [u8; 32];

    /// X25519 Diffie-Hellman. A shared secret that is all zeros (a low-order
    /// peer point) is rejected rather than stretched into a key.
    fn x25519_shared(
        &self,
        secret: &[u8; 32],
        peer_public: &[u8; 32],
    ) -> Result<Zeroizing<[u8; 32]>>;

    /// HKDF-SHA256 over a shared secret. Used to turn one DH result into a key
    /// bound to a specific recipient and file.
    fn hkdf_sha256(&self, ikm: &[u8], salt: &[u8], info: &[u8]) -> Result<Zeroizing<[u8; 32]>>;
}

/// Operating-system CSPRNG plus RustCrypto primitives.
#[derive(Debug, Default, Clone, Copy)]
pub struct NativeBackend;

impl CryptoBackend for NativeBackend {
    fn name(&self) -> &'static str {
        "native"
    }

    fn capabilities(&self) -> Vec<String> {
        vec![
            "rng:os".to_string(),
            "hash:sha256".to_string(),
            "kdf:argon2id".to_string(),
            "cipher:aes256-gcm".to_string(),
            "cipher:chacha20-poly1305".to_string(),
            "signature:ed25519".to_string(),
            "keyexchange:x25519".to_string(),
            "kdf:hkdf-sha256".to_string(),
        ]
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

    fn derive_key(
        &self,
        passphrase: &[u8],
        salt: &[u8; 16],
        params: KdfParams,
    ) -> Result<Zeroizing<[u8; 32]>> {
        params.validate()?;
        let argon_params = Params::new(
            params.m_cost_kib,
            params.t_cost,
            params.p_cost.into(),
            Some(32),
        )
        .map_err(|err| GimletEyeError::Internal(format!("invalid Argon2 parameters: {err}")))?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);

        let mut key = Zeroizing::new([0u8; 32]);
        argon
            .hash_password_into(passphrase, salt, key.as_mut())
            .map_err(|err| GimletEyeError::Tool(format!("key derivation failed: {err}")))?;
        Ok(key)
    }

    fn aead_encrypt(
        &self,
        algorithm: AeadAlgorithm,
        key: &[u8; 32],
        nonce: &[u8; 12],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>> {
        match algorithm {
            AeadAlgorithm::Aes256Gcm => {
                let cipher = Aes256Gcm::new_from_slice(key)
                    .map_err(|_| GimletEyeError::Internal("invalid AES-256 key".into()))?;
                cipher
                    .encrypt(
                        AesNonce::from_slice(nonce),
                        Payload {
                            msg: plaintext,
                            aad,
                        },
                    )
                    .map_err(|_| GimletEyeError::Tool("encryption failed".into()))
            }
            AeadAlgorithm::ChaCha20Poly1305 => {
                let cipher = ChaCha20Poly1305::new_from_slice(key)
                    .map_err(|_| GimletEyeError::Internal("invalid ChaCha20 key".into()))?;
                cipher
                    .encrypt(
                        ChaChaNonce::from_slice(nonce),
                        Payload {
                            msg: plaintext,
                            aad,
                        },
                    )
                    .map_err(|_| GimletEyeError::Tool("encryption failed".into()))
            }
        }
    }

    fn aead_decrypt(
        &self,
        algorithm: AeadAlgorithm,
        key: &[u8; 32],
        nonce: &[u8; 12],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>> {
        let plaintext = match algorithm {
            AeadAlgorithm::Aes256Gcm => {
                let cipher = Aes256Gcm::new_from_slice(key)
                    .map_err(|_| GimletEyeError::Internal("invalid AES-256 key".into()))?;
                cipher.decrypt(
                    AesNonce::from_slice(nonce),
                    Payload {
                        msg: ciphertext,
                        aad,
                    },
                )
            }
            AeadAlgorithm::ChaCha20Poly1305 => {
                let cipher = ChaCha20Poly1305::new_from_slice(key)
                    .map_err(|_| GimletEyeError::Internal("invalid ChaCha20 key".into()))?;
                cipher.decrypt(
                    ChaChaNonce::from_slice(nonce),
                    Payload {
                        msg: ciphertext,
                        aad,
                    },
                )
            }
        };
        plaintext.map(Zeroizing::new).map_err(|_| {
            GimletEyeError::Tool("decryption failed: wrong passphrase or corrupted file".into())
        })
    }

    fn ed25519_keygen(&self) -> Ed25519KeyPair {
        let signing = SigningKey::generate(&mut OsRng);
        Ed25519KeyPair {
            secret: signing.to_bytes(),
            public: signing.verifying_key().to_bytes(),
        }
    }

    fn ed25519_sign(&self, secret: &[u8; 32], message: &[u8]) -> Result<[u8; 64]> {
        let signing = SigningKey::from_bytes(secret);
        Ok(signing.sign(message).to_bytes())
    }

    fn ed25519_verify(
        &self,
        public: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> Result<()> {
        let key = VerifyingKey::from_bytes(public)
            .map_err(|err| GimletEyeError::InvalidArgs(format!("invalid public key: {err}")))?;
        let signature = Signature::from_bytes(signature);
        key.verify_strict(message, &signature)
            .map_err(|_| GimletEyeError::Tool("signature verification failed".into()))
    }

    fn ed25519_public(&self, secret: &[u8; 32]) -> [u8; 32] {
        SigningKey::from_bytes(secret).verifying_key().to_bytes()
    }

    fn x25519_keygen(&self) -> X25519KeyPair {
        let secret = StaticSecret::random_from_rng(OsRng);
        X25519KeyPair {
            secret: secret.to_bytes(),
            public: X25519Public::from(&secret).to_bytes(),
        }
    }

    fn x25519_public(&self, secret: &[u8; 32]) -> [u8; 32] {
        X25519Public::from(&StaticSecret::from(*secret)).to_bytes()
    }

    fn x25519_shared(
        &self,
        secret: &[u8; 32],
        peer_public: &[u8; 32],
    ) -> Result<Zeroizing<[u8; 32]>> {
        let secret = StaticSecret::from(*secret);
        let shared = secret.diffie_hellman(&X25519Public::from(*peer_public));
        if !shared.was_contributory() {
            return Err(GimletEyeError::InvalidArgs(
                "the recipient key is not a usable X25519 point".into(),
            ));
        }
        Ok(Zeroizing::new(shared.to_bytes()))
    }

    fn hkdf_sha256(&self, ikm: &[u8], salt: &[u8], info: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
        let hkdf = Hkdf::<Sha2>::new(Some(salt), ikm);
        let mut out = Zeroizing::new([0u8; 32]);
        hkdf.expand(info, out.as_mut())
            .map_err(|_| GimletEyeError::Internal("hkdf expansion failed".into()))?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: &str) -> Vec<u8> {
        (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("hex"))
            .collect()
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            NativeBackend.sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn random_bytes_are_the_right_length_and_not_constant() {
        let first = NativeBackend.random_bytes(32);
        let second = NativeBackend.random_bytes(32);
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
    }

    #[test]
    fn aes256_gcm_matches_nist_vector() {
        // NIST GCM test case 13: 256-bit zero key, zero IV, 16 zero bytes of
        // plaintext. Expected ciphertext followed by the authentication tag.
        let key = [0u8; 32];
        let nonce = [0u8; 12];
        let ciphertext = NativeBackend
            .aead_encrypt(AeadAlgorithm::Aes256Gcm, &key, &nonce, &[0u8; 16], b"")
            .expect("encrypt");
        assert_eq!(
            ciphertext,
            hex("cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919")
        );
    }

    #[test]
    fn chacha20_poly1305_round_trips_and_rejects_tampering() {
        let key = [7u8; 32];
        let nonce = [9u8; 12];
        let plaintext = b"attack at dawn".to_vec();

        let ciphertext = NativeBackend
            .aead_encrypt(
                AeadAlgorithm::ChaCha20Poly1305,
                &key,
                &nonce,
                &plaintext,
                b"hdr",
            )
            .expect("encrypt");
        assert_ne!(ciphertext, plaintext);

        let decrypted = NativeBackend
            .aead_decrypt(
                AeadAlgorithm::ChaCha20Poly1305,
                &key,
                &nonce,
                &ciphertext,
                b"hdr",
            )
            .expect("decrypt");
        assert_eq!(decrypted.as_slice(), plaintext.as_slice());

        // A flipped bit must fail the tag check.
        let mut tampered = ciphertext.clone();
        tampered[0] ^= 0x01;
        assert!(NativeBackend
            .aead_decrypt(
                AeadAlgorithm::ChaCha20Poly1305,
                &key,
                &nonce,
                &tampered,
                b"hdr"
            )
            .is_err());

        // So must a different AAD.
        assert!(NativeBackend
            .aead_decrypt(
                AeadAlgorithm::ChaCha20Poly1305,
                &key,
                &nonce,
                &ciphertext,
                b"other"
            )
            .is_err());
    }

    #[test]
    fn argon2id_is_deterministic_and_salt_sensitive() {
        let params = KdfParams {
            m_cost_kib: 64,
            t_cost: 1,
            p_cost: 1,
        };
        let salt = [3u8; 16];
        let first = NativeBackend
            .derive_key(b"passphrase", &salt, params)
            .expect("derive");
        let second = NativeBackend
            .derive_key(b"passphrase", &salt, params)
            .expect("derive");
        assert_eq!(first.as_ref(), second.as_ref());

        let other_salt = [4u8; 16];
        let third = NativeBackend
            .derive_key(b"passphrase", &other_salt, params)
            .expect("derive");
        assert_ne!(first.as_ref(), third.as_ref());
    }

    #[test]
    fn rejects_absurd_kdf_parameters() {
        let salt = [0u8; 16];
        let too_big = KdfParams {
            m_cost_kib: 10_000_000,
            t_cost: 2,
            p_cost: 1,
        };
        assert!(NativeBackend.derive_key(b"x", &salt, too_big).is_err());

        let zero_time = KdfParams {
            m_cost_kib: 64,
            t_cost: 0,
            p_cost: 1,
        };
        assert!(NativeBackend.derive_key(b"x", &salt, zero_time).is_err());
    }

    #[test]
    fn ed25519_matches_rfc8032_vector() {
        let secret: [u8; 32] =
            hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
                .try_into()
                .expect("secret");
        let signing = SigningKey::from_bytes(&secret);
        let public = signing.verifying_key().to_bytes();
        assert_eq!(
            public.to_vec(),
            hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        );

        let signature = NativeBackend.ed25519_sign(&secret, b"").expect("sign");
        assert_eq!(
            signature.to_vec(),
            hex(
                "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
            )
        );

        NativeBackend
            .ed25519_verify(&public, b"", &signature)
            .expect("verify");
        assert!(NativeBackend
            .ed25519_verify(&public, b"x", &signature)
            .is_err());
    }

    #[test]
    fn algorithm_names_round_trip() {
        for algorithm in [AeadAlgorithm::Aes256Gcm, AeadAlgorithm::ChaCha20Poly1305] {
            assert_eq!(
                AeadAlgorithm::parse(algorithm.as_str()).expect("parse"),
                algorithm
            );
            assert_eq!(
                AeadAlgorithm::from_wire(algorithm.to_wire()).expect("wire"),
                algorithm
            );
        }
        assert!(AeadAlgorithm::from_wire(99).is_err());
        assert_eq!(
            AeadAlgorithm::parse("AES-256-GCM").expect("case"),
            AeadAlgorithm::Aes256Gcm
        );
    }
}
