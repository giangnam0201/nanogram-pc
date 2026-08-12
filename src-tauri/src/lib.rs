mod commands;
mod config;
mod http;
mod oauth;
mod store;

use http::Api;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("no app data dir available");
            std::fs::create_dir_all(&dir).ok();

            let api = Api::new(store::SessionStore::new(&dir));
            app.manage::<Arc<Api>>(api);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_state,
            commands::api_request,
            commands::api_auth_request,
            commands::logout,
            commands::game_url,
            commands::share_url,
            commands::invite_url,
            commands::game_token,
            commands::login_discord,
            commands::login_google,
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nanogram");
}
