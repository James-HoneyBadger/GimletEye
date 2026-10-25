use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use mellivora_core::{
    token, AppPaths, AuditLog, Capability, CapabilitySet, Config, PackFailure, PackSummary,
    PluginHost, Registry, Result, Tool, ToolContext,
};
use mellivora_crypto::{CryptoBackend, NativeBackend};
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

/// The credential `/api/v1` should require, or `None` when
/// `[api] require_token` is off.
///
/// Reads `MELLIVORA_API_TOKEN` first (the test suite and CI use it), then the
/// token file, and generates one — with the platform RNG, which is why this
/// lives here and not in `core` — on first use.
pub fn issue_api_token(paths: &AppPaths, config: &Config) -> Result<Option<String>> {
    if !config.api.require_token {
        return Ok(None);
    }
    if let Some(from_env) = token::from_env() {
        return Ok(Some(from_env));
    }
    if let Some(existing) = token::load(&paths.api_token_file)? {
        return Ok(Some(existing));
    }
    let generated = token::encode(&NativeBackend.random_bytes(token::TOKEN_BYTES));
    token::store(&paths.api_token_file, &generated)?;
    tracing::info!(
        path = %paths.api_token_file.display(),
        "generated an API token"
    );
    Ok(Some(generated))
}

/// Resolve the token for a surface that needs it before it builds its runtime —
/// the desktop shell injects it into the window as soon as the port is known.
pub fn api_token_for_home(home: Option<PathBuf>) -> Result<Option<String>> {
    let paths = home.map(AppPaths::under).unwrap_or_else(AppPaths::discover);
    let config = Config::load(&paths)?;
    issue_api_token(&paths, &config)
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

    pub fn api_token(&self) -> Result<Option<String>> {
        issue_api_token(&self.paths, &self.config)
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
        api_token: Option<String>,
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
        if let Some(token) = api_token {
            state = state.with_token(token);
        }
        (state, host)
    }
}

/// Every native tool this build ships.
pub fn builtin_tools() -> Result<Vec<Arc<dyn Tool>>> {
    crate::tools()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(name: &str) -> AppPaths {
        let dir =
            std::env::temp_dir().join(format!("mellivora-token-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        AppPaths::under(dir)
    }

    #[test]
    fn a_token_is_generated_once_and_reused() {
        if token::from_env().is_some() {
            return; // the environment overrides the file; nothing to assert
        }
        let paths = paths("issue");
        let config = Config::default();

        let first = issue_api_token(&paths, &config)
            .expect("issue")
            .expect("required by default");
        assert_eq!(first.len(), token::TOKEN_BYTES * 2);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()), "{first}");

        let second = issue_api_token(&paths, &config)
            .expect("issue")
            .expect("still required");
        assert_eq!(first, second, "a second call must reuse the stored token");
    }

    #[test]
    fn the_token_is_off_when_the_config_says_so() {
        let mut config = Config::default();
        config.api.require_token = false;
        let token = issue_api_token(&paths("disabled"), &config).expect("issue");
        assert!(token.is_none());
    }
}
