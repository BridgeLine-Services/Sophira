//! Sophira desktop shell (Tauri v2).
//!
//! ARCHITECTURE: the desktop app is a native window that loads the deployed
//! Sophira web application (see `windows[0].url` in tauri.conf.json). The
//! web app stays the single canonical implementation — no core logic is
//! forked into the desktop target. Auth, uploads, AI and learning all run
//! through the same server as the browser app.
//!
//! Set the deployment URL in tauri.conf.json (or see docs/NATIVE_BUILDS.md
//! for the per-environment override used by CI). Never bundle secrets here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Sophira desktop shell");
}
