use std::env;
use std::path::PathBuf;

use crate::error::Result;

/// Resolved locations for configuration, state, and plugin discovery.
///
/// Everything the toolkit writes lives under a single root so a backup, a
/// container mount, or a test fixture is one path. `MELLIVORA_HOME` overrides
/// the root, which is how the test suite keeps runs hermetic.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub audit_file: PathBuf,
    pub plugin_dirs: Vec<PathBuf>,
}

impl AppPaths {
    /// Resolve from the environment, falling back to the XDG config directory.
    pub fn discover() -> Self {
        let root = env::var_os("MELLIVORA_HOME")
            .map(PathBuf::from)
            .or_else(|| dirs::config_dir().map(|dir| dir.join("mellivora")))
            .unwrap_or_else(|| PathBuf::from(".mellivora"));
        Self::under(root)
    }

    /// Build the layout under an explicit root.
    pub fn under(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let mut plugin_dirs = vec![root.join("plugins")];

        if let Some(extra) = env::var_os("MELLIVORA_PLUGIN_PATH") {
            for entry in env::split_paths(&extra) {
                if !entry.as_os_str().is_empty() && !plugin_dirs.contains(&entry) {
                    plugin_dirs.push(entry);
                }
            }
        }

        // Packs checked out next to the sources are picked up during development.
        let repo_local = PathBuf::from("plugins");
        if repo_local.is_dir() && !plugin_dirs.contains(&repo_local) {
            plugin_dirs.push(repo_local);
        }

        Self {
            config_file: root.join("config.toml"),
            config_dir: root.clone(),
            data_dir: root.join("data"),
            cache_dir: root.join("cache"),
            audit_file: root.join("audit.jsonl"),
            root,
            plugin_dirs,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_is_derived_from_root() {
        let paths = AppPaths::under("/tmp/mellivora-test");
        assert_eq!(
            paths.config_file,
            PathBuf::from("/tmp/mellivora-test/config.toml")
        );
        assert_eq!(
            paths.audit_file,
            PathBuf::from("/tmp/mellivora-test/audit.jsonl")
        );
        assert!(paths
            .plugin_dirs
            .contains(&PathBuf::from("/tmp/mellivora-test/plugins")));
    }
}
