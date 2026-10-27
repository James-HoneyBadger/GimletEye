use std::env;
use std::path::{Path, PathBuf};

use crate::error::Result;

/// Resolved locations for configuration and state.
///
/// Everything the toolkit writes lives under a single root so a backup, a
/// container mount, or a test fixture is one path. `GIMLET_HOME` overrides
/// the root, which is how the test suite keeps runs hermetic.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub audit_file: PathBuf,
    /// Sealed key store, created on first `crypto.key-*` write with mode 0600.
    pub keystore_file: PathBuf,
}

impl AppPaths {
    /// Resolve from the environment, falling back to the XDG config directory.
    pub fn discover() -> Self {
        let root = env::var_os("GIMLET_HOME")
            .map(PathBuf::from)
            .or_else(legacy_root)
            .or_else(default_root)
            .unwrap_or_else(|| PathBuf::from(".gimlet"));
        Self::under(root)
    }

    /// Build the layout under an explicit root.
    pub fn under(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self {
            config_file: root.join("config.toml"),
            config_dir: root.clone(),
            data_dir: root.join("data"),
            cache_dir: root.join("cache"),
            audit_file: root.join("audit.jsonl"),
            keystore_file: keystore_path(&root),
            root,
        }
    }

    /// Create the directories the toolkit writes into.
    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(&self.config_dir)?;
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::create_dir_all(&self.cache_dir)?;
        Ok(())
    }
}

/// The root used before the rename. An installation that already has one keeps
/// using it, so an upgrade does not strand a keystore or an audit trail.
fn legacy_root() -> Option<PathBuf> {
    let config = dirs::config_dir()?;
    let legacy = config.join("mellivora");
    let current = config.join("gimlet");
    (legacy.is_dir() && !current.exists()).then_some(legacy)
}

fn default_root() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("gimlet"))
}

/// A keystore sealed before the rename is read where it is rather than at the
/// new name, which does not exist yet.
fn keystore_path(root: &Path) -> PathBuf {
    let current = root.join("keystore.gimlet");
    let legacy = root.join("keystore.melv");
    if !current.exists() && legacy.is_file() {
        legacy
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_is_derived_from_root() {
        let paths = AppPaths::under("/tmp/gimlet-test");
        assert_eq!(
            paths.config_file,
            PathBuf::from("/tmp/gimlet-test/config.toml")
        );
        assert_eq!(
            paths.audit_file,
            PathBuf::from("/tmp/gimlet-test/audit.jsonl")
        );
        assert_eq!(
            paths.keystore_file,
            PathBuf::from("/tmp/gimlet-test/keystore.gimlet")
        );
    }

    #[test]
    fn a_keystore_from_before_the_rename_is_still_found() {
        let dir = std::env::temp_dir().join(format!("gimlet-paths-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("keystore.melv"), b"sealed").expect("write");

        assert_eq!(
            AppPaths::under(&dir).keystore_file,
            dir.join("keystore.melv")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
