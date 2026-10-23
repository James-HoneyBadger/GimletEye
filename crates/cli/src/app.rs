use std::path::PathBuf;
use std::time::Duration;

use mellivora_core::{
    AppPaths, AuditLog, Capability, CapabilitySet, Config, PackFailure, PackSummary, PluginHost,
    Registry, Result, ToolContext,
};

/// Composition root: one place that knows which modules exist.
///
/// Adding a module means one line here; surfaces never change.
pub struct Runtime {
    pub paths: AppPaths,
    pub config: Config,
    pub registry: Registry,
    pub host: Option<PluginHost>,
}

impl Runtime {
    pub fn load(home: Option<PathBuf>, with_plugins: bool) -> Result<Self> {
        let paths = home.map(AppPaths::under).unwrap_or_else(AppPaths::discover);
        let config = Config::load(&paths)?;

        let mut registry = Registry::new();
        registry.register_all(mellivora_sysadmin::tools()?)?;
        registry.register_all(mellivora_crypto::tools()?)?;
        registry.register_all(mellivora_scrub::tools()?)?;

        let host = if with_plugins {
            let dirs = config.effective_plugin_dirs(&paths);
            let host = PluginHost::load(
                &dirs,
                &config.plugins.disabled,
                Duration::from_millis(config.plugins.timeout_ms),
            );
            for tool in host.tools() {
                // A pack that collides with a built-in id is skipped rather
                // than allowed to shadow a trusted tool.
                if let Err(err) = registry.register(tool) {
                    tracing::warn!(%err, "skipping pack tool");
                }
            }
            Some(host)
        } else {
            None
        };

        Ok(Self {
            paths,
            config,
            registry,
            host,
        })
    }

    pub fn context(&self, dry_run: bool) -> ToolContext {
        let granted = if self.config.plugins.allow.is_empty() {
            CapabilitySet::all()
        } else {
            let mut set = CapabilitySet::none();
            for name in &self.config.plugins.allow {
                match name.parse::<Capability>() {
                    Ok(capability) => {
                        set.insert(capability);
                    }
                    Err(err) => tracing::warn!(%err, "ignoring unknown capability"),
                }
            }
            set
        };

        ToolContext::new(self.paths.clone())
            .with_config(self.config.clone())
            .with_dry_run(dry_run || self.config.defaults.dry_run)
            .with_capabilities(granted)
    }

    pub fn audit_log(&self) -> Option<AuditLog> {
        if !self.config.audit.enabled {
            return None;
        }
        Some(AuditLog::new(
            self.config.audit_path(&self.paths),
            self.config.audit.max_entries,
        ))
    }

    pub fn pack_summaries(&self) -> Vec<PackSummary> {
        self.host
            .as_ref()
            .map(PluginHost::summaries)
            .unwrap_or_default()
    }

    pub fn pack_failures(&self) -> Vec<PackFailure> {
        self.host
            .as_ref()
            .map(|host| host.failures().to_vec())
            .unwrap_or_default()
    }
}
