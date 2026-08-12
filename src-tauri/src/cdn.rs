//! CloudFront access for games, thumbnails and pictures.
//!
//! Everything under `*.nanogram.app` is served by a CloudFront distribution
//! that requires signed cookies; without them every asset answers
//! `403 MissingKey`. The Android client fetches those cookies from
//! `cf-cookies.nanogram.app/cookie` and installs them into the WebView cookie
//! store.
//!
//! A desktop webview has no portable cookie-writing API, so instead of putting
//! credentials in the webview we proxy CDN traffic through a custom URI scheme
//! and attach the cookies here. The webview only ever sees `cdn:` URLs, and the
//! CloudFront signature stays in the native process.

use crate::http::Api;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const COOKIE_ENDPOINT: &str = "https://cf-cookies.nanogram.app/cookie";
const DEFAULT_TTL_SECS: u64 = 3600;

/// Hosts we are willing to proxy. The scheme handler refuses anything else so a
/// malicious game cannot turn the proxy into an open relay.
const ALLOWED_HOSTS: &[&str] = &[
    "games.nanogram.app",
    "pictures.nanogram.app",
    "nanogram.app",
];

pub fn is_allowed_host(host: &str) -> bool {
    ALLOWED_HOSTS.contains(&host)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Default)]
struct CookieState {
    /// `name=value` pairs, already formatted for a Cookie header.
    header: Option<String>,
    fetched_at: u64,
    ttl_secs: u64,
}

impl CookieState {
    /// Android re-syncs once an eighth of the lifetime has passed, well before
    /// expiry, so a long play session never trips over a stale signature.
    fn is_stale(&self) -> bool {
        let Some(_) = self.header else { return true };
        if self.fetched_at == 0 {
            return true;
        }
        let now = now_secs();
        let ttl = self.ttl_secs.max(1);
        now >= self.fetched_at + ttl || now - self.fetched_at >= ttl / 8
    }
}

pub struct Cdn {
    client: reqwest::Client,
    api: Arc<Api>,
    state: Mutex<CookieState>,
}

impl Cdn {
    pub fn new(api: Arc<Api>) -> Arc<Self> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("NanogramPC/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(60))
            .pool_max_idle_per_host(8)
            .build()
            .expect("failed to build cdn client");
        Arc::new(Self {
            client,
            api,
            state: Mutex::new(CookieState::default()),
        })
    }

    /// Current cookie header, refreshing when stale. Returns `None` when signed
    /// out — public assets may still load, so this is not fatal.
    async fn cookie_header(&self) -> Option<String> {
        let mut state = self.state.lock().await;
        if !state.is_stale() {
            return state.header.clone();
        }

        let token = self.api.access_token_for_webview().await?;

        let resp = self
            .client
            .get(COOKIE_ENDPOINT)
            .bearer_auth(token)
            .send()
            .await
            .ok()?;

        if !resp.status().is_success() {
            log::warn!("cdn cookie sync failed: {}", resp.status());
            // Keep serving the old cookies if we still have some.
            return state.header.clone();
        }

        let pairs: Vec<String> = resp
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|c| c.split(';').next())
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .map(str::to_string)
            .collect();

        if pairs.is_empty() {
            return state.header.clone();
        }

        let ttl = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("expires_in").and_then(serde_json::Value::as_u64))
            .unwrap_or(DEFAULT_TTL_SECS);

        state.header = Some(pairs.join("; "));
        state.fetched_at = now_secs();
        state.ttl_secs = ttl.max(60);
        state.header.clone()
    }

    /// Fetch an upstream CDN asset. Returns (status, content-type, body).
    pub async fn fetch(&self, host: &str, path_and_query: &str) -> (u16, String, Vec<u8>) {
        if !is_allowed_host(host) {
            return (403, "text/plain".into(), b"host not allowed".to_vec());
        }

        let url = format!("https://{host}/{}", path_and_query.trim_start_matches('/'));
        let mut req = self.client.get(&url);
        if let Some(cookies) = self.cookie_header().await {
            req = req.header(reqwest::header::COOKIE, cookies);
        }

        match req.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let content_type = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let body = resp.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
                (status, content_type, body)
            }
            Err(e) => {
                log::warn!("cdn fetch failed for {url}: {e}");
                (502, "text/plain".into(), b"upstream error".to_vec())
            }
        }
    }

    /// Drop cached cookies, e.g. on sign-out.
    pub async fn clear(&self) {
        *self.state.lock().await = CookieState::default();
    }
}

/// Split a proxy request path (`/games.nanogram.app/games/x/thumbnail.png`)
/// into its upstream host and remainder.
pub fn split_target(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim_start_matches('/');
    let (host, rest) = match trimmed.split_once('/') {
        Some((h, r)) => (h, r),
        None => (trimmed, ""),
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), rest.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_host_from_path() {
        let (host, rest) = split_target("/games.nanogram.app/games/abc/game/index.html").unwrap();
        assert_eq!(host, "games.nanogram.app");
        assert_eq!(rest, "games/abc/game/index.html");
    }

    #[test]
    fn splits_host_with_no_remainder() {
        let (host, rest) = split_target("/games.nanogram.app").unwrap();
        assert_eq!(host, "games.nanogram.app");
        assert_eq!(rest, "");
    }

    #[test]
    fn rejects_empty_path() {
        assert!(split_target("/").is_none());
        assert!(split_target("").is_none());
    }

    #[test]
    fn only_nanogram_hosts_are_proxied() {
        assert!(is_allowed_host("games.nanogram.app"));
        assert!(is_allowed_host("pictures.nanogram.app"));
        assert!(!is_allowed_host("evil.example"));
        assert!(!is_allowed_host("games.nanogram.app.evil.example"));
    }

    #[test]
    fn fresh_cookies_are_not_stale() {
        let state = CookieState {
            header: Some("a=b".into()),
            fetched_at: now_secs(),
            ttl_secs: 3600,
        };
        assert!(!state.is_stale());
    }

    #[test]
    fn cookies_go_stale_after_an_eighth_of_their_life() {
        let state = CookieState {
            header: Some("a=b".into()),
            fetched_at: now_secs() - 500,
            ttl_secs: 3600,
        };
        assert!(state.is_stale());
    }

    #[test]
    fn missing_cookies_are_stale() {
        assert!(CookieState::default().is_stale());
    }
}
