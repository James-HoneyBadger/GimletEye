use std::net::SocketAddr;
use std::path::PathBuf;

use mellivora_core::{MellivoraError, Result};

use crate::Runtime;

fn engine() -> Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|err| MellivoraError::Internal(err.to_string()))
}

/// Serve the API (and optionally the UI) until the process exits.
pub fn serve_blocking(
    runtime: Runtime,
    address: SocketAddr,
    ui_dir: Option<PathBuf>,
    dry_run: bool,
) -> Result<()> {
    let (state, _packs) = runtime.into_app_state(dry_run, ui_dir);
    engine()?.block_on(mellivora_server::serve(state, address))
}

/// Serve on an already-bound listener, which lets a caller discover the port
/// before it needs the address (the desktop shell does exactly that).
pub fn serve_on_listener(
    runtime: Runtime,
    listener: std::net::TcpListener,
    ui_dir: Option<PathBuf>,
    dry_run: bool,
) -> Result<()> {
    let (state, _packs) = runtime.into_app_state(dry_run, ui_dir);
    let engine = engine()?;
    engine.block_on(async move {
        listener
            .set_nonblocking(true)
            .map_err(|err| MellivoraError::Io(format!("cannot configure listener: {err}")))?;
        let listener = tokio::net::TcpListener::from_std(listener)
            .map_err(|err| MellivoraError::Io(format!("cannot adopt listener: {err}")))?;
        mellivora_server::serve_listener(state, listener).await
    })
}
