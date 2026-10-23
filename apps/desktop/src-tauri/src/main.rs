#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Thin shell: the UI bundle is the same one the browser uses, and all
//! behaviour lives behind the local HTTP API. Keeping the shell empty is what
//! lets the web, desktop, and future ARM/PicoCalc surfaces share one UI.

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start the Mellivora desktop shell");
}
