//! Mellivora ToolKit — core contracts.
//!
//! Every capability in the toolkit, whether it lives in a Rust module or in a
//! pack written in any language, is expressed as a [`Tool`] that returns a
//! [`Report`]. The CLI, the HTTP API, the WASM target, and the desktop shell
//! all consume that same contract, which is what keeps the surfaces thin.

pub mod audit;
pub mod config;
pub mod error;
pub mod paths;
pub mod plugin;
pub mod registry;
pub mod report;
pub mod token;
pub mod tool;
pub mod util;

pub use audit::{AuditEntry, AuditLog};
pub use config::{Config, Defaults, PluginSettings};
pub use error::{MellivoraError, Result};
pub use paths::AppPaths;
pub use plugin::{PackFailure, PackManifest, PackSummary, PluginHost, PluginTool};
pub use registry::{similarity, Registry};
pub use report::{Finding, OutputFormat, Report, Severity, Status};
pub use tool::{
    ArgKind, ArgSpec, Args, Capability, CapabilitySet, Category, Tool, ToolContext, ToolManifest,
};

/// Toolkit version, shared by the CLI, the HTTP API, and the plugin handshake.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
