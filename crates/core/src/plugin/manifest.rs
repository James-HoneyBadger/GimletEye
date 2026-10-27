use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{GimletEyeError, Result};
use crate::plugin::protocol::PROTOCOL_VERSION;
use crate::tool::Capability;

pub const MANIFEST_FILENAME: &str = "gimlet-pack.toml";
/// Packs written before the rename carry their manifest under the old name.
pub const LEGACY_MANIFEST_FILENAME: &str = "mellivora-pack.toml";
/// Every name a manifest may be found under, current name first.
pub const MANIFEST_FILENAMES: [&str; 2] = [MANIFEST_FILENAME, LEGACY_MANIFEST_FILENAME];

/// The manifest in `dir`, preferring the current name.
pub fn find_manifest(dir: &Path) -> Option<PathBuf> {
    MANIFEST_FILENAMES
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
}

/// Where a manifest for `dir` is reported, whether or not it exists.
pub fn manifest_path(dir: &Path) -> PathBuf {
    find_manifest(dir).unwrap_or_else(|| dir.join(MANIFEST_FILENAME))
}

/// Declarative description of a pack, committed next to its executable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackManifest {
    pub name: String,
    pub version: String,
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u32,
    #[serde(default)]
    pub description: Option<String>,
    /// argv for the pack executable; the first entry is the program.
    pub command: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// Worst-case runtime for this pack's tools. Overrides the host default,
    /// which matters for tools that walk a filesystem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

fn default_protocol_version() -> u32 {
    PROTOCOL_VERSION
}

fn default_enabled() -> bool {
    true
}

impl PackManifest {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path)?;
        let manifest: Self = toml::from_str(&raw)?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn from_dir(dir: &Path) -> Result<Self> {
        let path = find_manifest(dir).ok_or_else(|| {
            GimletEyeError::NotFound(format!(
                "no {MANIFEST_FILENAME} (or {LEGACY_MANIFEST_FILENAME}) in {}",
                dir.display()
            ))
        })?;
        Self::load(&path)
    }

    fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(GimletEyeError::Config(
                "pack manifest is missing a name".into(),
            ));
        }
        if self.command.is_empty() {
            return Err(GimletEyeError::Config(format!(
                "pack '{}' has an empty command",
                self.name
            )));
        }
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(GimletEyeError::Plugin(format!(
                "pack '{}' speaks protocol version {}, host speaks {PROTOCOL_VERSION}",
                self.name, self.protocol_version
            )));
        }
        Ok(())
    }

    pub fn program(&self) -> Result<(&str, &[String])> {
        self.command
            .split_first()
            .map(|(program, args)| (program.as_str(), args))
            .ok_or_else(|| {
                GimletEyeError::Config(format!("pack '{}' has an empty command", self.name))
            })
    }
}

/// Directories that contain a pack manifest: the directory itself or any
/// descendant up to `depth` levels.
pub fn manifest_dirs(dir: &Path, depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    collect(dir, depth, &mut found);
    found.sort();
    found.dedup();
    found
}

fn collect(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                if MANIFEST_FILENAMES.contains(&name) {
                    found.push(dir.to_path_buf());
                }
            }
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if matches!(name, "target" | "node_modules" | ".git" | "dist") {
            continue;
        }
        collect(&path, depth - 1, found);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gimlet-pack-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn parses_a_manifest() {
        let dir = temp_dir("parse");
        let path = dir.join(MANIFEST_FILENAME);
        fs::write(
            &path,
            r#"
name = "example"
version = "0.1.0"
description = "Perl Den sysadmin catalogue"
command = ["perl", "pack.pl"]
capabilities = ["process:exec", "fs:read"]
"#,
        )
        .expect("write");

        let manifest = PackManifest::load(&path).expect("load");
        assert_eq!(manifest.name, "example");
        assert_eq!(manifest.protocol_version, PROTOCOL_VERSION);
        assert!(manifest.enabled);
        assert_eq!(manifest.capabilities.len(), 2);
        assert_eq!(manifest.timeout_ms, None);
        assert_eq!(manifest.program().expect("program").0, "perl");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_a_pack_timeout_override() {
        let dir = temp_dir("timeout");
        let path = dir.join(MANIFEST_FILENAME);
        fs::write(
            &path,
            "name=\"slow\"\nversion=\"1\"\ncommand=[\"true\"]\ntimeout_ms = 120000\n",
        )
        .expect("write");

        let manifest = PackManifest::load(&path).expect("load");
        assert_eq!(manifest.timeout_ms, Some(120_000));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_protocol_version() {
        let dir = temp_dir("protocol");
        let path = dir.join(MANIFEST_FILENAME);
        fs::write(
            &path,
            "name = \"x\"\nversion = \"1\"\nprotocol_version = 99\ncommand = [\"x\"]\n",
        )
        .expect("write");

        let err = PackManifest::load(&path).expect_err("must reject");
        assert_eq!(err.code(), "plugin");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_nested_manifests() {
        let dir = temp_dir("discover");
        let nested = dir.join("packs").join("demo");
        fs::create_dir_all(&nested).expect("nested");
        fs::write(
            nested.join(MANIFEST_FILENAME),
            "name=\"demo\"\nversion=\"1\"\ncommand=[\"true\"]\n",
        )
        .expect("write");

        let found = manifest_dirs(&dir, 3);
        assert_eq!(found, vec![nested]);

        let _ = fs::remove_dir_all(&dir);
    }
}
