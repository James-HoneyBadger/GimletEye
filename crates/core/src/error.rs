use std::fmt;

use serde::{Serialize, Serializer};

/// The single error type crossing every layer of the toolkit.
#[derive(Debug, thiserror::Error)]
pub enum GimletEyeError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("i/o error: {0}")]
    Io(String),
    #[error("plugin error: {0}")]
    Plugin(String),
    #[error("plugin timed out after {0} ms")]
    Timeout(u64),
    #[error("capability denied: {0}")]
    CapabilityDenied(String),
    #[error("tool failed: {0}")]
    Tool(String),
    #[error("unsupported operation: {0}")]
    Unsupported(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl GimletEyeError {
    /// Stable, machine-readable identifier. Used by the HTTP API and the
    /// plugin protocol, so these strings are part of the public contract.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(_) => "config",
            Self::InvalidArgs(_) => "invalid_args",
            Self::NotFound(_) => "not_found",
            Self::Io(_) => "io",
            Self::Plugin(_) => "plugin",
            Self::Timeout(_) => "timeout",
            Self::CapabilityDenied(_) => "capability_denied",
            Self::Tool(_) => "tool",
            Self::Unsupported(_) => "unsupported",
            Self::Internal(_) => "internal",
        }
    }
}

impl Serialize for GimletEyeError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;

        let mut state = serializer.serialize_struct("GimletEyeError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<std::io::Error> for GimletEyeError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<serde_json::Error> for GimletEyeError {
    fn from(err: serde_json::Error) -> Self {
        Self::Internal(format!("json: {err}"))
    }
}

impl From<toml::de::Error> for GimletEyeError {
    fn from(err: toml::de::Error) -> Self {
        Self::Config(err.to_string())
    }
}

impl From<toml::ser::Error> for GimletEyeError {
    fn from(err: toml::ser::Error) -> Self {
        Self::Config(err.to_string())
    }
}

impl From<fmt::Error> for GimletEyeError {
    fn from(err: fmt::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, GimletEyeError>;
