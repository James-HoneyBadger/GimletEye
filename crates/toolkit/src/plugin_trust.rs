//! Pack trust: pin what a pack is, and refuse it when it changes.
//!
//! A pack is an arbitrary executable that may declare `process:exec`. Discovery
//! alone therefore trusts whatever is on disk this morning, which is fine for a
//! pack checked out from the repository and not fine for anything else. Pinning
//! a digest turns "the pack directory is the one I reviewed" into something the
//! host can check.
//!
//! The digest covers every file in the pack directory: relative path, size, and
//! the hash of the content, in sorted order. Renaming, editing, adding, or
//! removing anything changes it. See ADR 0006 - this is evidence, not a sandbox.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use gimlet_eye_core::plugin::{manifest_path, PackFailure, PackManifest};
use gimlet_eye_core::Result;
use gimlet_eye_crypto::{CryptoBackend, NativeBackend};

/// Prefix used in configuration so the algorithm can change without ambiguity.
pub const PREFIX: &str = "sha256:";

/// Files larger than this are hashed but not held in memory all at once; the cap
/// only guards against a pack that ships something absurd.
const MAX_ENTRIES: usize = 4096;
const MAX_DEPTH: usize = 8;

/// The digest of a pack directory, as stored in `[trust]`.
pub fn digest(dir: &Path) -> Result<String> {
    let backend = NativeBackend;
    let mut files: Vec<PathBuf> = Vec::new();
    collect(dir, dir, 0, &mut files)?;
    files.sort();

    let mut parts = String::new();
    for path in &files {
        let relative = path
            .strip_prefix(dir)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = fs::read(path)?;
        parts.push_str(&relative);
        parts.push('\u{0}');
        parts.push_str(&bytes.len().to_string());
        parts.push('\u{0}');
        parts.push_str(&backend.sha256_hex(&bytes));
        parts.push('\n');
    }

    Ok(format!("{PREFIX}{}", backend.sha256_hex(parts.as_bytes())))
}

fn collect(root: &Path, dir: &Path, depth: usize, out: &mut Vec<PathBuf>) -> Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if depth == 0 => return Err(error.into()),
        // A subdirectory that cannot be read is skipped rather than aborting the
        // digest: the alternative is that one unreadable file hides the pin.
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect(root, &path, depth + 1, out)?;
        } else if file_type.is_file() {
            out.push(path);
            if out.len() > MAX_ENTRIES {
                return Err(gimlet_eye_core::GimletEyeError::Config(format!(
                    "{}: more than {MAX_ENTRIES} files; refusing to digest the pack",
                    root.display()
                )));
            }
        }
    }
    Ok(())
}

/// Split a configured pin into its algorithm prefix and value.
fn parse_pin(value: &str) -> (&str, &str) {
    match value.split_once(':') {
        Some((algorithm, rest)) => (algorithm, rest),
        None => ("sha256", value),
    }
}

/// Keep only the packs whose digest matches their pin.
///
/// Unpinned packs pass: trust is opt-in per pack so that pinning one pack does
/// not silently disable the others. A pinned pack that is missing or different is
/// refused with a failure the user can act on.
pub fn filter(
    found: Vec<(PathBuf, PackManifest)>,
    pins: &BTreeMap<String, String>,
) -> (Vec<(PathBuf, PackManifest)>, Vec<PackFailure>) {
    if pins.is_empty() {
        return (found, Vec::new());
    }

    let mut kept = Vec::new();
    let mut failures = Vec::new();
    let mut pinned_seen: Vec<String> = Vec::new();

    for (dir, manifest) in found {
        let Some(pin) = pins.get(&manifest.name) else {
            kept.push((dir, manifest));
            continue;
        };
        pinned_seen.push(manifest.name.clone());

        let (algorithm, expected) = parse_pin(pin.trim());
        if algorithm != "sha256" {
            failures.push(PackFailure {
                manifest_path: manifest_path(&dir),
                error: format!(
                    "pack '{}' is pinned with an unknown algorithm '{algorithm}' (use sha256:)",
                    manifest.name
                ),
            });
            continue;
        }

        match digest(&dir) {
            Ok(actual) => {
                let actual_hex = actual.trim_start_matches(PREFIX);
                if actual_hex.eq_ignore_ascii_case(expected) {
                    tracing::debug!(pack = %manifest.name, "pack digest matches its pin");
                    kept.push((dir, manifest));
                } else {
                    failures.push(PackFailure {
                        manifest_path: manifest_path(&dir),
                        error: format!(
                            "pack '{}' does not match its pinned digest\n  pinned: {PREFIX}{expected}\n  actual: {actual}\n\
                             If the change is intended, update `[trust]` in config.toml; if not, do not run this pack.",
                            manifest.name
                        ),
                    });
                }
            }
            Err(error) => failures.push(PackFailure {
                manifest_path: manifest_path(&dir),
                error: format!("pack '{}' could not be hashed: {error}", manifest.name),
            }),
        }
    }

    for name in pins.keys() {
        if !pinned_seen.contains(name) {
            failures.push(PackFailure {
                manifest_path: PathBuf::from(format!("<{name}>")),
                error: format!(
                    "pack '{name}' is pinned in [trust] but was not found; \
                     an uninstalled pack is worth knowing about"
                ),
            });
        }
    }

    (kept, failures)
}
