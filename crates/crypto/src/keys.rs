//! Ed25519 key material and its on-disk representation.
//!
//! Keys are plain files, not a keystore: this layer only knows how to encode,
//! decode, and write them. A secret key file is created with mode 0600 and is
//! never printed in a report.

use std::fs;
use std::path::Path;

use mellivora_core::{MellivoraError, Result};
use serde::{Deserialize, Serialize};

pub const ALGORITHM: &str = "ed25519";
pub const SECRET_EXTENSION: &str = "key";
pub const PUBLIC_EXTENSION: &str = "pub";

/// A signing keypair. The secret is 32 bytes; the public part is derived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ed25519KeyPair {
    pub secret: [u8; 32],
    pub public: [u8; 32],
}

#[derive(Debug, Serialize, Deserialize)]
struct KeyFile {
    algorithm: String,
    public_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secret_key: Option<String>,
}

pub fn encode_secret(pair: &Ed25519KeyPair) -> String {
    let file = KeyFile {
        algorithm: ALGORITHM.to_string(),
        public_key: hex_encode(&pair.public),
        secret_key: Some(hex_encode(&pair.secret)),
    };
    serde_json::to_string_pretty(&file).unwrap_or_default()
}

pub fn encode_public(pair: &Ed25519KeyPair) -> String {
    let file = KeyFile {
        algorithm: ALGORITHM.to_string(),
        public_key: hex_encode(&pair.public),
        secret_key: None,
    };
    serde_json::to_string_pretty(&file).unwrap_or_default()
}

pub fn decode_secret(text: &str) -> Result<[u8; 32]> {
    let file = parse(text)?;
    let secret = file.secret_key.ok_or_else(|| {
        MellivoraError::InvalidArgs("this is a public key file, not a secret key".into())
    })?;
    to_array(&secret)
}

pub fn decode_public(text: &str) -> Result<[u8; 32]> {
    to_array(&parse(text)?.public_key)
}

pub fn write_secret(path: &Path, pair: &Ed25519KeyPair) -> Result<()> {
    create_parent(path)?;
    fs::write(path, encode_secret(pair))?;
    restrict_permissions(path)?;
    Ok(())
}

pub fn write_public(path: &Path, pair: &Ed25519KeyPair) -> Result<()> {
    create_parent(path)?;
    fs::write(path, encode_public(pair))?;
    Ok(())
}

pub fn public_hex(pair: &Ed25519KeyPair) -> String {
    hex_encode(&pair.public)
}

fn parse(text: &str) -> Result<KeyFile> {
    let file: KeyFile = serde_json::from_str(text)
        .map_err(|err| MellivoraError::InvalidArgs(format!("not an ed25519 key file: {err}")))?;
    if file.algorithm != ALGORITHM {
        return Err(MellivoraError::Unsupported(format!(
            "key algorithm '{}' is not supported",
            file.algorithm
        )));
    }
    Ok(file)
}

fn to_array(hex: &str) -> Result<[u8; 32]> {
    let bytes = hex_decode(hex)?;
    bytes
        .try_into()
        .map_err(|_| MellivoraError::InvalidArgs("key must be 32 bytes".into()))
}

fn create_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

fn restrict_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

pub fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn hex_decode(text: &str) -> Result<Vec<u8>> {
    let text = text.trim();
    if text.len() % 2 != 0 {
        return Err(MellivoraError::InvalidArgs(
            "hex string has an odd length".into(),
        ));
    }
    (0..text.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&text[index..index + 2], 16)
                .map_err(|_| MellivoraError::InvalidArgs("invalid hex in key material".into()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair() -> Ed25519KeyPair {
        Ed25519KeyPair {
            secret: [1u8; 32],
            public: [2u8; 32],
        }
    }

    #[test]
    fn round_trips_a_secret_key() {
        let text = encode_secret(&pair());
        assert_eq!(decode_secret(&text).expect("decode"), [1u8; 32]);
        assert_eq!(decode_public(&text).expect("public"), [2u8; 32]);
    }

    #[test]
    fn public_file_has_no_secret() {
        let text = encode_public(&pair());
        assert!(!text.contains("secret_key"));
        assert!(decode_secret(&text).is_err());
    }

    #[test]
    fn rejects_wrong_algorithm_and_bad_hex() {
        let wrong = r#"{"algorithm":"rsa","public_key":"00"}"#;
        assert_eq!(
            decode_public(wrong).expect_err("algorithm").code(),
            "unsupported"
        );

        let bad_hex = r#"{"algorithm":"ed25519","public_key":"zz"}"#;
        assert_eq!(
            decode_public(bad_hex).expect_err("hex").code(),
            "invalid_args"
        );

        let short = r#"{"algorithm":"ed25519","public_key":"00"}"#;
        assert_eq!(
            decode_public(short).expect_err("length").code(),
            "invalid_args"
        );
    }

    #[test]
    fn writes_secret_with_owner_only_permissions() {
        let dir = std::env::temp_dir().join(format!("mellivora-keys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("test.key");
        write_secret(&path, &pair()).expect("write");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("metadata").permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert_eq!(
            decode_secret(&fs::read_to_string(&path).expect("read")).expect("decode"),
            [1u8; 32]
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
