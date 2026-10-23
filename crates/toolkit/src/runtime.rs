use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use mellivora_core::{
    AppPaths, AuditLog, Capability, CapabilitySet, Config, PackFailure, PackSummary, PluginHost,
    Registry, Result, Tool, ToolContext,
};
use mellivora_server::AppState;

/// Everything a surface needs: configuration, the tool catalogue, and any packs.
pub struct Runtime {
    pub paths: AppPaths,
    pub config: Config,
    pub registry: Registry,
    pub host: Option<PluginHost>,
}

fn context_for(paths: &AppPaths, config: &Config, dry_run: bool) -> ToolContext {
    let granted = if config.plugins.allow.is_empty() {
        CapabilitySet::all()
    } else {
        let mut set = CapabilitySet::none();
        for name in &config.plugins.allow {
            match name.parse::<Capability>() {
                Ok(capability) => {
                    set.insert(capability);
                }
                Err(err) => tracing::warn!(%err, "ignoring unknown capability"),
            }
        }
        set
    };

    ToolContext::new(paths.clone())
        .with_config(config.clone())
        .with_dry_run(dry_run || config.defaults.dry_run)
        .with_capabilities(granted)
}

impl Runtime {
    pub fn load(home: Option<PathBuf>, with_plugins: bool) -> Result<Self> {
        let paths = home.map(AppPaths::under).unwrap_or_else(AppPaths::discover);
        let config = Config::load(&paths)?;

        let mut registry = Registry::new();
        registry.register_all(builtin_tools()?)?;

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
        context_for(&self.paths, &self.config, dry_run)
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

    /// Split into an HTTP application state plus the pack host that must stay
    /// alive for as long as the state is serving.
    pub fn into_app_state(
        self,
        dry_run: bool,
        ui_dir: Option<PathBuf>,
    ) -> (AppState, Option<PluginHost>) {
        let Self {
            paths,
            config,
            registry,
            host,
        } = self;
        let context = context_for(&paths, &config, dry_run);
        let packs = host.as_ref().map(PluginHost::summaries).unwrap_or_default();
        let audit = if config.audit.enabled {
            Some(AuditLog::new(
                config.audit_path(&paths),
                config.audit.max_entries,
            ))
        } else {
            None
        };

        let mut state = AppState::new(Arc::new(registry), context, config).with_packs(packs);
        if let Some(log) = audit {
            state = state.with_audit(log);
        }
        if let Some(dir) = ui_dir {
            state = state.with_ui_dir(dir);
        }
        (state, host)
    }
}

/// Every native tool this build ships.
pub fn builtin_tools() -> Result<Vec<Arc<dyn Tool>>> {
    crate::tools()
}
