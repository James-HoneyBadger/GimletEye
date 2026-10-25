//! The credential that protects `/api/v1`.
//!
//! The API runs on the user's machine and can read, write, and delete files, so
//! a loopback bind is not by itself a boundary: any page the user visits can
//! reach `127.0.0.1` from their browser. The token is the boundary.
//!
//! This module only reads, writes, and compares the token. Generation happens
//! where the platform RNG lives — see `mellivora_toolkit::issue_api_token` — so
//! `core` stays free of crypto dependencies.

use std::fs;
use std::path::Path;

use crate::error::{MellivoraError, Result};

/// Set this to drive the API without reading the token file, which is how the
/// test suite and CI do it.
pub const TOKEN_ENV: &str = "MELLIVORA_API_TOKEN";

/// Bytes of entropy in a generated token (rendered as hex, so twice as long).
pub const TOKEN_BYTES: usize = 32;

/// Read the token, or `None` when the file does not exist yet.
pub fn load(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let token = raw.trim();
            if token.is_empty() {
                return Err(MellivoraError::Config(format!(
                    "API token file {} is empty; delete it to have a new token generated",
                    path.display()
                )));
            }
            Ok(Some(token.to_string()))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Write the token owner-only.
pub fn store(path: &Path, token: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, format!("{token}\n"))?;
    restrict_permissions(path)
}

/// Token supplied through the environment, if any.
pub fn from_env() -> Option<String> {
    std::env::var(TOKEN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Compare a presented credential with the expected one without leaking where
/// they diverge through timing.
pub fn matches(presented: &str, expected: &str) -> bool {
    let presented = presented.as_bytes();
    let expected = expected.as_bytes();
    if presented.len() != expected.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in presented.iter().zip(expected) {
        difference |= left ^ right;
    }
    difference == 0
}

/// Render random bytes as the hex text a token file holds.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mellivora-token-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    #[test]
    fn round_trips_and_trims() {
        let dir = temp_dir("round-trip");
        let path = dir.join("api-token");

        assert_eq!(load(&path).expect("load"), None);
        store(&path, "abc123").expect("store");
        assert_eq!(load(&path).expect("load").as_deref(), Some("abc123"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_token_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("permissions");
        let path = dir.join("api-token");
        store(&path, "secret").expect("store");

        let mode = fs::metadata(&path).expect("metadata").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_file_is_an_error_rather_than_a_free_pass() {
        let dir = temp_dir("empty");
        let path = dir.join("api-token");
        fs::write(&path, "\n  \n").expect("write");

        let err = load(&path).expect_err("must not accept an empty token");
        assert_eq!(err.code(), "config");
        assert!(err.to_string().contains("delete it"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn comparison_is_exact() {
        assert!(matches("abcdef", "abcdef"));
        assert!(!matches("abcdef", "abcdeg"));
        assert!(!matches("abc", "abcdef"));
        assert!(!matches("", "abcdef"));
        assert!(!matches("abcdef", ""));
    }

    #[test]
    fn encoding_is_hex_of_the_bytes() {
        assert_eq!(encode(&[0x00, 0x0f, 0xff]), "000fff");
        assert_eq!(encode(&[]), "");
    }
}
