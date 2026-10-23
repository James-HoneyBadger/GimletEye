//! HTTP surface consumed by the desktop shell and the browser UI.
//!
//! Deliberately thin: it resolves a tool, runs it, and returns the same
//! [`mellivora_core::Report`] the CLI prints. No business logic lives here, so
//! adding a module never means touching a handler.

mod error;
mod routes;

pub use error::ApiError;
pub use routes::{router, serve, serve_listener, AppState};
