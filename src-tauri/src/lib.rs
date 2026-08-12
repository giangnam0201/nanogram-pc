mod cdn;
mod commands;
mod config;
mod http;
mod oauth;
mod preview;
mod store;

use cdn::Cdn;
use http::Api;
use preview::Previews;
use std::sync::Arc;
use tauri::{Manager, UriSchemeResponder};

/// Custom scheme the webview uses for anything behind the CloudFront
/// distribution. See `cdn.rs` for why the traffic is proxied.
pub const CDN_SCHEME: &str = "cdn";

/// Custom scheme that hosts GameGen builds on their own origin.
pub const PREVIEW_SCHEME: &str = "preview";

fn empty_response(status: u16) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("static response")
}

fn respond(responder: UriSchemeResponder, status: u16, content_type: String, body: Vec<u8>) {
    let response = tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, content_type)
        // The proxy is the only consumer; keep it locked down.
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "public, max-age=300")
        .body(body);

    match response {
        Ok(r) => responder.respond(r),
        Err(e) => log::error!("failed to build cdn response: {e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(CDN_SCHEME, |ctx, request, responder| {
            let cdn = ctx.app_handle().state::<Arc<Cdn>>().inner().clone();

            // Only the path matters; the host is a placeholder Tauri supplies.
            let uri = request.uri();
            let target = match uri.query() {
                Some(q) => format!("{}?{}", uri.path(), q),
                None => uri.path().to_string(),
            };

            tauri::async_runtime::spawn(async move {
                let Some((host, rest)) = cdn::split_target(&target) else {
                    respond(responder, 400, "text/plain".into(), b"bad request".to_vec());
                    return;
                };
                let (status, content_type, body) = cdn.fetch(&host, &rest).await;
                respond(responder, status, content_type, body);
            });
        })
        .register_uri_scheme_protocol(PREVIEW_SCHEME, |ctx, request| {
            let previews = ctx.app_handle().state::<Previews>();
            let id = request.uri().path().trim_start_matches('/');

            match previews.get(id) {
                Some(html) => tauri::http::Response::builder()
                    .status(200)
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        "text/html; charset=utf-8",
                    )
                    .header("Cache-Control", "no-store")
                    .body(html.into_bytes())
                    .unwrap_or_else(|_| empty_response(500)),
                None => empty_response(404),
            }
        })
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("no app data dir available");
            std::fs::create_dir_all(&dir).ok();

            let api = Api::new(store::SessionStore::new(&dir));
            let cdn = Cdn::new(api.clone());
            app.manage::<Arc<Api>>(api);
            app.manage::<Arc<Cdn>>(cdn);
            app.manage(Previews::new());
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
            commands::stage_preview,
            commands::game_token,
            commands::login_discord,
            commands::login_google,
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nanogram");
}
