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
    /// Credential for `/api/v1`, created on first `serve` with mode 0600.
    pub api_token_file: PathBuf,
    /// Sealed key store, created on first `crypto.key-*` write with mode 0600.
    pub keystore_file: PathBuf,
    pub plugin_dirs: Vec<PathBuf>,
}

/// Append a directory unless the same directory is already listed.
///
/// The comparison is on the canonical path, because `plugins` and
/// `/home/you/project/plugins` are the same directory with two spellings —
/// which used to load every pack twice and start each pack process twice.
pub(crate) fn push_unique_dir(
    dirs: &mut Vec<PathBuf>,
    seen: &mut Vec<PathBuf>,
    candidate: PathBuf,
) {
    let identity = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.clone());
    if seen.contains(&identity) {
        return;
    }
    seen.push(identity);
    dirs.push(candidate);
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
        let mut plugin_dirs = Vec::new();
        let mut seen = Vec::new();
        push_unique_dir(&mut plugin_dirs, &mut seen, root.join("plugins"));

        if let Some(extra) = env::var_os("MELLIVORA_PLUGIN_PATH") {
            for entry in env::split_paths(&extra) {
                if !entry.as_os_str().is_empty() {
                    push_unique_dir(&mut plugin_dirs, &mut seen, entry);
                }
            }
        }

        // Packs checked out next to the sources are picked up during development.
        let repo_local = PathBuf::from("plugins");
        if repo_local.is_dir() {
            push_unique_dir(&mut plugin_dirs, &mut seen, repo_local);
        }

        Self {
            config_file: root.join("config.toml"),
            config_dir: root.clone(),
            data_dir: root.join("data"),
            cache_dir: root.join("cache"),
            audit_file: root.join("audit.jsonl"),
            api_token_file: root.join("api-token"),
            keystore_file: root.join("keystore.melv"),
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
    fn the_same_directory_in_two_spellings_is_listed_once() {
        let dir = std::env::temp_dir().join(format!("mellivora-paths-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let canonical = dir.canonicalize().expect("canonical");

        let mut dirs = Vec::new();
        let mut seen = Vec::new();
        push_unique_dir(&mut dirs, &mut seen, dir.clone());
        push_unique_dir(&mut dirs, &mut seen, canonical.clone());
        push_unique_dir(&mut dirs, &mut seen, dir.join("./"));

        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0], dir);

        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

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
        assert_eq!(
            paths.api_token_file,
            PathBuf::from("/tmp/mellivora-test/api-token")
        );
        assert_eq!(
            paths.keystore_file,
            PathBuf::from("/tmp/mellivora-test/keystore.melv")
        );
        assert!(paths
            .plugin_dirs
            .contains(&PathBuf::from("/tmp/mellivora-test/plugins")));
    }
}
