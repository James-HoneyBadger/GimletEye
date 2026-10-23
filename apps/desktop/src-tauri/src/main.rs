#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Thin shell: it starts the engine in-process, then points the window at it.
//!
//! The window renders the same bundle the browser does and carries no logic of
//! its own. The only thing the shell owns is the lifetime of the engine and the
//! port it listens on.

use std::path::PathBuf;

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Bind before the window exists so the port is known when its first
            // script runs.
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();

            discover_pack_dirs();
            eprintln!("mellivora: embedded engine on http://127.0.0.1:{port}");

            std::thread::spawn(move || match mellivora_toolkit::Runtime::load(None, true) {
                Ok(runtime) => {
                    if let Err(error) =
                        mellivora_toolkit::serve_on_listener(runtime, listener, None, false)
                    {
                        eprintln!("mellivora: embedded engine stopped: {error}");
                    }
                }
                Err(error) => eprintln!("mellivora: cannot start engine: {error}"),
            });

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Mellivora ToolKit")
                .inner_size(1240.0, 860.0)
                .min_inner_size(880.0, 600.0)
                .initialization_script(format!(
                    "window.__MELLIVORA_API__ = 'http://127.0.0.1:{port}';"
                ))
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Mellivora desktop shell");
}

/// Look for packs next to the binary (installed layout) or the checkout
/// (development layout), and hand them to the engine via the documented
/// `MELLIVORA_PLUGIN_PATH` variable.
fn discover_pack_dirs() {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().skip(1).take(6) {
            candidates.push(ancestor.join("plugins"));
        }
    }

    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(here.join("../../../plugins"));

    let mut existing: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        if canonical.is_dir() && !existing.contains(&canonical) {
            existing.push(canonical);
        }
    }
    if existing.is_empty() {
        return;
    }
    if let Ok(joined) = std::env::join_paths(existing) {
        if std::env::var_os("MELLIVORA_PLUGIN_PATH").is_none() {
            std::env::set_var("MELLIVORA_PLUGIN_PATH", joined);
        }
    }
}
