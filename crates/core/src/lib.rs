//! Gimlet Eye — core contracts.
//!
//! Every capability the verified engine ships is expressed as a [`Tool`] that
//! returns a [`Report`]. `gimlet-sidecar` exposes exactly that contract over
//! stdio, which is what keeps the desktop app and the CLI from growing a second
//! implementation of it.

pub mod audit;
pub mod config;
pub mod error;
pub mod paths;
pub mod platform;
pub mod registry;
pub mod report;
pub mod tool;
pub mod util;

pub use audit::{AuditEntry, AuditLog};
pub use config::{AuditSettings, Config, Defaults};
pub use error::{GimletEyeError, Result};
pub use paths::AppPaths;
pub use registry::{similarity, Registry};
pub use report::{Finding, OutputFormat, Report, Severity, Status};
pub use tool::{
    ArgKind, ArgSpec, Args, Capability, CapabilitySet, Category, Tool, ToolContext, ToolManifest,
};

/// Engine version, reported by the sidecar handshake.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
