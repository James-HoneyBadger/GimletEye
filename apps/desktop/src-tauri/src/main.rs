#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Thin shell: it starts the engine in-process, then points the window at it.
//!
//! The window renders the same bundle the browser does and carries no logic of
//! its own. The only thing the shell owns is the lifetime of the engine and the
//! port it listens on.
//!
//! The window loads the bundle **from the engine's own HTTP server**, not from
//! Tauri's embedded assets. That is not a preference: on Linux the webview runs
//! the embedded copy on `tauri://localhost` and refuses a cross-scheme fetch to
//! `http://127.0.0.1:<port>`, which left the UI reporting itself offline with an
//! empty catalogue and nothing to click. Serving both from one origin removes
//! the cross-origin request instead of working around it.

use std::path::PathBuf;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Bind before the window exists so the port is known when its first
            // script runs.
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();

            discover_pack_dirs();

            // Issued here rather than in the engine thread so the window can be
            // told the credential in the same breath as the port.
            let api_token = gimlet_eye_toolkit::api_token_for_home(None)?;
            let token_literal = match api_token.as_deref() {
                Some(token) => serde_json::to_string(token)?,
                None => "null".to_string(),
            };
            eprintln!(
                "gimlet: embedded engine on http://127.0.0.1:{port}{}",
                if api_token.is_some() {
                    " (API token required)"
                } else {
                    " ([api] require_token = false)"
                }
            );

            // The browser build is served from the same origin as the API, so
            // the UI never makes a cross-origin request.
            let ui_dir = resolve_ui_dir(app.handle());
            match &ui_dir {
                Some(dir) => eprintln!("gimlet: serving the UI from {}", dir.display()),
                None => eprintln!(
                    "gimlet: no UI directory found; the window will load the embedded \
                     copy and cannot reach the API. Set GIMLET_DESKTOP_UI_DIR or build \
                     packages/ui (./run.sh does)."
                ),
            }

            let token_for_engine = api_token.clone();
            let ui_for_engine = ui_dir.clone();
            std::thread::spawn(move || match gimlet_eye_toolkit::Runtime::load(None, true) {
                Ok(runtime) => {
                    if let Err(error) = gimlet_eye_toolkit::serve_on_listener(
                        runtime,
                        listener,
                        ui_for_engine,
                        false,
                        token_for_engine,
                    ) {
                        eprintln!("gimlet: embedded engine stopped: {error}");
                    }
                }
                Err(error) => eprintln!("gimlet: cannot start engine: {error}"),
            });

            // Same origin as the API when the bundle is on disk; the embedded
            // copy is only a fallback for a build that shipped without it.
            let url = match &ui_dir {
                Some(_) => WebviewUrl::External(
                    format!("http://127.0.0.1:{port}/")
                        .parse()
                        .expect("a loopback URL parses"),
                ),
                None => WebviewUrl::App("index.html".into()),
            };

            WebviewWindowBuilder::new(app, "main", url)
                .title("Gimlet Eye")
                .inner_size(1240.0, 860.0)
                .min_inner_size(880.0, 600.0)
                .initialization_script(format!(
                    "window.__GIMLET_API__ = 'http://127.0.0.1:{port}';\n\
                     window.__GIMLET_TOKEN__ = {token_literal};"
                ))
                .build()?;

            Ok(())
        })
        // The event loop ends when the last window goes away, so a clean exit
        // is a window closing — say so rather than leaving it a mystery.
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                eprintln!("gimlet: window '{}' asked to close", window.label());
            }
            tauri::WindowEvent::Destroyed => {
                eprintln!("gimlet: window '{}' destroyed", window.label());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Gimlet Eye desktop shell");
}

/// Where the window's files come from.
///
/// Three places, in order: an explicit override (tests and unusual layouts), the
/// bundle's resources (a packaged app), and the checkout (`run.sh` and `cargo
/// run`). `index.html` is the test, because a directory without it would serve a
/// 404 page that looks like a broken app.
fn resolve_ui_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("GIMLET_DESKTOP_UI_DIR").map(PathBuf::from) {
        if dir.join("index.html").is_file() {
            return Some(dir);
        }
        eprintln!(
            "gimlet: GIMLET_DESKTOP_UI_DIR points at {}, which has no index.html",
            dir.display()
        );
    }

    if let Ok(resources) = app.path().resource_dir() {
        for candidate in [resources.join("ui"), resources.join("packages/ui/dist")] {
            if candidate.join("index.html").is_file() {
                return Some(candidate);
            }
        }
    }

    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/ui/dist");
    if checkout.join("index.html").is_file() {
        return Some(checkout);
    }
    None
}

/// Look for packs next to the binary (installed layout) or the checkout
/// (development layout), and hand them to the engine via the documented
/// `GIMLET_PLUGIN_PATH` variable.
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
        if std::env::var_os("GIMLET_PLUGIN_PATH").is_none() {
            std::env::set_var("GIMLET_PLUGIN_PATH", joined);
        }
    }
}
