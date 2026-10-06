// Strike Wing desktop shell: a native window around the bundled game (dist/).
// Everything is served from inside the app; no network access is needed.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Strike Wing");
}
