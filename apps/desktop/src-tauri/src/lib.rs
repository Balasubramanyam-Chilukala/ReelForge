//! ReelForge desktop shell (thin). Responsibilities only:
//!   * start the Node backend daemon as a child process on launch,
//!   * tell it (and read back) a fixed bridge state-file path,
//!   * expose `get_bridge_info` to the webview so the UI can connect.
//! No editing logic lives here — that is all in the TypeScript engine/backend.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, State};

#[derive(Serialize, Clone)]
struct BridgeInfo {
    port: u16,
    token: String,
}

struct AppStateInner {
    state_file: PathBuf,
}

type AppState = Mutex<AppStateInner>;

/// Read the bridge state file the backend publishes; returns null until it is ready.
#[tauri::command]
fn get_bridge_info(state: State<'_, AppState>) -> Option<BridgeInfo> {
    let path = { state.lock().ok()?.state_file.clone() };
    let text = fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let port = json.get("port")?.as_u64()? as u16;
    let token = json.get("token")?.as_str()?.to_string();
    Some(BridgeInfo { port, token })
}

/// Best-effort launch of the Node backend bundled under resources. If this fails (e.g. Node
/// not installed, or running a dev build without bundled resources), the UI still works when
/// a backend is started manually (`reelforge-backend`); the user is guided via Settings.
fn spawn_backend(app: &tauri::App, state_file: &PathBuf, data_dir: &PathBuf) {
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let entry = resource_dir.join("backend").join("reelforge-backend.cjs");
    if !entry.exists() {
        return;
    }
    let _ = Command::new(node_binary())
        .arg("--no-warnings")
        .arg(entry)
        .env("REELFORGE_STATE_FILE", state_file)
        .env("REELFORGE_DATA_DIR", data_dir)
        .spawn();
}

fn node_binary() -> &'static str {
    // Rely on Node on PATH. Production installers may bundle a Node sidecar instead.
    "node"
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&data_dir);
            let state_file = data_dir.join("bridge.json");
            // Remove a stale state file so get_bridge_info doesn't connect to a dead daemon.
            let _ = fs::remove_file(&state_file);
            spawn_backend(app, &state_file, &data_dir);
            app.manage(Mutex::new(AppStateInner { state_file }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_bridge_info])
        .run(tauri::generate_context!())
        .expect("error while running ReelForge");
}
