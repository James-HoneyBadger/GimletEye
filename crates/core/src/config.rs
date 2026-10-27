use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{GimletEyeError, Result};
use crate::paths::AppPaths;
use crate::report::OutputFormat;

pub const CONFIG_SCHEMA_VERSION: u32 = 1;

/// One config file for every surface. Modules own their own namespaced keys in
/// [`Config::modules`], so adding a crate never means editing core.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub schema_version: u32,
    pub defaults: Defaults,
    pub audit: AuditSettings,
    /// Module-scoped settings keyed by namespace (`sysadmin`, `privacy`, ...).
    pub modules: BTreeMap<String, toml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Defaults {
    pub output: OutputFormat,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AuditSettings {
    pub enabled: bool,
    /// Overrides the default `<root>/audit.jsonl`.
    pub path: Option<PathBuf>,
    pub max_entries: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            defaults: Defaults::default(),
            audit: AuditSettings::default(),
            modules: BTreeMap::new(),
        }
    }
}

impl Default for Defaults {
    fn default() -> Self {
        Self {
            output: OutputFormat::Text,
            dry_run: false,
        }
    }
}

impl Default for AuditSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            path: None,
            max_entries: 1_000,
        }
    }
}

impl Config {
    /// Load from `<root>/config.toml`, or defaults when the file is absent.
    pub fn load(paths: &AppPaths) -> Result<Self> {
        Self::load_from(&paths.config_file)
    }

    pub fn load_from(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(path)?;
        Self::parse(&raw)
    }

    pub fn parse(raw: &str) -> Result<Self> {
        let config: Self = toml::from_str(raw)?;
        if config.schema_version > CONFIG_SCHEMA_VERSION {
            return Err(GimletEyeError::Config(format!(
                "config schema {} is newer than supported schema {CONFIG_SCHEMA_VERSION}",
                config.schema_version
            )));
        }
        Ok(config)
    }

    pub fn to_toml(&self) -> Result<String> {
        Ok(toml::to_string_pretty(self)?)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, self.to_toml()?)?;
        Ok(())
    }

    /// Read a module namespace without pulling a domain dependency into core.
    pub fn module(&self, namespace: &str) -> Option<&toml::Value> {
        self.modules.get(namespace)
    }

    pub fn audit_path(&self, paths: &AppPaths) -> PathBuf {
        self.audit
            .path
            .clone()
            .unwrap_or_else(|| paths.audit_file.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_usable() {
        let config = Config::default();
        assert_eq!(config.schema_version, CONFIG_SCHEMA_VERSION);
        assert_eq!(config.defaults.output, OutputFormat::Text);
        assert!(config.audit.enabled);
        assert_eq!(config.audit.max_entries, 1_000);
    }

    #[test]
    fn a_config_from_a_release_that_had_packs_still_loads() {
        // `[plugins]` and `[api]` belonged to surfaces that no longer exist.
        // The file on disk is not the user's fault, so it parses and the dead
        // sections are ignored rather than failing the build.
        let config = Config::parse(
            r#"
            schema_version = 1

            [defaults]
            output = "json"

            [plugins]
            timeout_ms = 1000

            [api]
            require_token = false
            "#,
        )
        .expect("parse");
        assert_eq!(config.defaults.output, crate::report::OutputFormat::Json);
    }

    #[test]
    fn partial_toml_fills_defaults() {
        let config = Config::parse(
            r#"
            schema_version = 1

            [defaults]
            output = "json"

            [modules.sysadmin]
            warn_load_percent = 90
            "#,
        )
        .expect("parse");
        assert_eq!(config.defaults.output, OutputFormat::Json);
        assert!(config.audit.enabled);
        assert!(config.module("sysadmin").is_some());
    }

    #[test]
    fn forward_schema_is_rejected() {
        let err = Config::parse("schema_version = 99").expect_err("must reject");
        assert_eq!(err.code(), "config");
    }

    #[test]
    fn round_trips_through_toml() {
        let mut config = Config::default();
        config.defaults.output = OutputFormat::Markdown;
        config
            .modules
            .insert("privacy".into(), toml::Value::Integer(7));

        let encoded = config.to_toml().expect("serialize");
        let decoded = Config::parse(&encoded).expect("parse");
        assert_eq!(decoded.defaults.output, OutputFormat::Markdown);
        assert!(decoded.module("privacy").is_some());
    }
}
