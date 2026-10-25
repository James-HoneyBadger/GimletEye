//! Composition root.
//!
//! The only place that knows which modules exist. The CLI, the HTTP server, and
//! the desktop shell all build their runtime from here, so adding a module is a
//! single line in [`builtin_tools`] and every surface gains it.

mod runtime;
mod serve;

pub use runtime::{api_token_for_home, builtin_tools, issue_api_token, Runtime};
pub use serve::{serve_blocking, serve_on_listener};

use std::sync::Arc;

use mellivora_core::{Result, Tool};

/// Every native tool, in registration order.
pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    let mut tools = Vec::new();
    tools.extend(mellivora_sysadmin::tools()?);
    tools.extend(mellivora_crypto::tools()?);
    tools.extend(mellivora_scrub::tools()?);
    Ok(tools)
}
