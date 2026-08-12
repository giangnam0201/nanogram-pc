//! Tauri commands — the only bridge between the UI and the network.
//!
//! The UI never holds a token: it names an endpoint, Rust attaches credentials,
//! refreshes them and returns JSON. That keeps the access token out of the
//! webview's reach even though the UI itself is rendered there.

use crate::config;
use crate::http::{Api, ApiError, ApiResult, RequestSpec};
use crate::oauth;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize)]
pub struct SessionState {
    #[serde(rename = "loggedIn")]
    logged_in: bool,
    #[serde(rename = "userId")]
    user_id: Option<String>,
}

#[tauri::command]
pub async fn session_state(api: State<'_, Arc<Api>>) -> ApiResult<SessionState> {
    let s = api.session().await;
    Ok(SessionState {
        logged_in: s.is_logged_in(),
        user_id: s.user_id,
    })
}

/// Generic authenticated call. `path` is relative to the API base, e.g.
/// `v2/games/feed`. Mirrors the Retrofit services one-for-one.
#[tauri::command]
pub async fn api_request(spec: RequestSpec, api: State<'_, Arc<Api>>) -> ApiResult<Value> {
    api.request(&spec).await
}

/// Endpoints that mint a session: the response token pair is adopted before the
/// body is handed back to the UI.
#[tauri::command]
pub async fn api_auth_request(spec: RequestSpec, api: State<'_, Arc<Api>>) -> ApiResult<Value> {
    let value = api.request(&spec).await?;
    // Onboarding-completion responses carry no tokens; adopt only when present.
    if value.get("accessToken").is_some() {
        api.adopt_token_pair(&value).await?;
    }
    Ok(value)
}

#[tauri::command]
pub async fn logout(api: State<'_, Arc<Api>>) -> ApiResult<()> {
    let refresh = api.session().await.refresh_token;
    if let Some(token) = refresh {
        // Best-effort server-side revoke; local state is cleared regardless.
        let _ = api
            .request(&RequestSpec {
                method: "POST".into(),
                path: "auth/logout".into(),
                query: None,
                body: Some(json!({ "refreshToken": token })),
            })
            .await;
    }
    api.clear_session().await;
    Ok(())
}

#[tauri::command]
pub fn game_url(game_id: String) -> String {
    config::game_play_url(&game_id)
}

#[tauri::command]
pub fn share_url(game_id: String) -> String {
    config::game_share_url(&game_id)
}

/// Token for the game runtime, refreshed if stale.
#[tauri::command]
pub async fn game_token(api: State<'_, Arc<Api>>) -> ApiResult<Option<String>> {
    Ok(api.access_token_for_webview().await)
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/// Open an authorize page in its own webview window and resolve with the query
/// parameters of the redirect, without ever letting the redirect load.
async fn capture_oauth_redirect(
    app: &AppHandle,
    label: &str,
    title: &str,
    authorize_url: String,
    redirect_uri: String,
) -> ApiResult<std::collections::HashMap<String, String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));

    let parsed = url::Url::parse(&authorize_url)
        .map_err(|e| ApiError::Network(format!("bad authorize url: {e}")))?;

    let label = label.to_string();
    let title = title.to_string();
    let app_for_build = app.clone();
    let build_label = label.clone();

    let (built_tx, built_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();

    // Window creation must happen on the main thread (required on macOS).
    app.run_on_main_thread(move || {
        let sender = sender.clone();
        let redirect_uri = redirect_uri.clone();
        let result =
            WebviewWindowBuilder::new(&app_for_build, &build_label, WebviewUrl::External(parsed))
                .title(title)
                .inner_size(520.0, 720.0)
                .center()
                .resizable(true)
                .on_navigation(move |url| {
                    let current = url.to_string();
                    if oauth::is_redirect_match(&current, &redirect_uri) {
                        if let Ok(mut guard) = sender.lock() {
                            if let Some(tx) = guard.take() {
                                let _ = tx.send(oauth::parse_query(&current));
                            }
                        }
                        // Stop the redirect from loading; we already have the code.
                        return false;
                    }
                    true
                })
                .build()
                .map(|_| ())
                .map_err(|e| e.to_string());
        let _ = built_tx.send(result);
    })
    .map_err(|e| ApiError::Network(e.to_string()))?;

    built_rx
        .await
        .map_err(|e| ApiError::Network(e.to_string()))?
        .map_err(|e| ApiError::Network(format!("could not open sign-in window: {e}")))?;

    let outcome = tokio::time::timeout(OAUTH_TIMEOUT, rx).await;

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }

    match outcome {
        Ok(Ok(params)) => Ok(params),
        _ => Err(ApiError::Network("Sign-in was cancelled".into())),
    }
}

#[tauri::command]
pub async fn login_discord(app: AppHandle, api: State<'_, Arc<Api>>) -> ApiResult<Value> {
    // Nanogram hands us its own Discord app credentials — we never invent one.
    let cfg = api
        .request(&RequestSpec {
            method: "GET".into(),
            path: "config".into(),
            query: None,
            body: None,
        })
        .await?;

    let client_id = cfg
        .get("discordClientId")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::Network("Discord sign-in is not available right now".into()))?;
    let redirect_uri = cfg
        .get("discordRedirectUri")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::Network("Discord sign-in is not available right now".into()))?;

    let state = oauth::random_urlsafe(16);
    let url = oauth::discord_authorize_url(client_id, redirect_uri, &state);

    let params = capture_oauth_redirect(
        &app,
        "oauth-discord",
        "Continue with Discord",
        url,
        redirect_uri.to_string(),
    )
    .await?;

    if params.get("state").map(String::as_str) != Some(state.as_str()) {
        return Err(ApiError::Network("Sign-in could not be verified".into()));
    }
    let code = params
        .get("code")
        .ok_or_else(|| ApiError::Network("Discord did not return a code".into()))?;

    let value = api
        .request(&RequestSpec {
            method: "POST".into(),
            path: "auth/discord".into(),
            query: None,
            body: Some(json!({ "code": code, "redirectUri": redirect_uri })),
        })
        .await?;

    api.adopt_token_pair(&value).await?;
    let _ = app.emit("nanogram://session-changed", true);
    Ok(value)
}

#[tauri::command]
pub async fn login_google(app: AppHandle, api: State<'_, Arc<Api>>) -> ApiResult<Value> {
    let capture = oauth::LoopbackCapture::bind()
        .await
        .map_err(|e| ApiError::Network(format!("could not start sign-in listener: {e}")))?;
    let redirect_uri = capture.redirect_uri();

    let state = oauth::random_urlsafe(16);
    let nonce = oauth::random_urlsafe(16);
    let (verifier, challenge) = oauth::pkce_pair();

    let url = oauth::google_authorize_url(
        config::GOOGLE_CLIENT_ID,
        &redirect_uri,
        &state,
        &challenge,
        &nonce,
    );

    // Google refuses embedded webviews, so this one goes to the real browser.
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| ApiError::Network(format!("could not open browser: {e}")))?;

    let params = capture
        .wait(OAUTH_TIMEOUT)
        .await
        .ok_or_else(|| ApiError::Network("Sign-in was cancelled".into()))?;

    if params.get("state").map(String::as_str) != Some(state.as_str()) {
        return Err(ApiError::Network("Sign-in could not be verified".into()));
    }
    let code = params
        .get("code")
        .ok_or_else(|| ApiError::Network("Google did not return a code".into()))?;

    let id_token = exchange_google_code(code, &verifier, &redirect_uri).await?;

    let value = api
        .request(&RequestSpec {
            method: "POST".into(),
            path: "v2/auth/google".into(),
            query: None,
            body: Some(json!({ "idToken": id_token })),
        })
        .await?;

    api.adopt_token_pair(&value).await?;
    let _ = app.emit("nanogram://session-changed", true);
    Ok(value)
}

/// Trade the authorization code for an `id_token`, which is what
/// `v2/auth/google` consumes.
async fn exchange_google_code(code: &str, verifier: &str, redirect_uri: &str) -> ApiResult<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", config::GOOGLE_CLIENT_ID),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| ApiError::Network(e.to_string()))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| ApiError::Decode(e.to_string()))?;

    if !status.is_success() {
        let detail = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("Google rejected the sign-in");
        return Err(ApiError::Network(detail.to_string()));
    }

    body.get("id_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ApiError::Decode("Google returned no id_token".into()))
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    // Only ever hand http(s) to the OS opener.
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("refusing to open non-web url".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}
