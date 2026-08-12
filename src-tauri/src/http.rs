//! Authenticated HTTP client.
//!
//! Reproduces the Android networking stack: an interceptor that attaches
//! `Bearer <access>` to every call except the auth bootstrap endpoints, plus an
//! authenticator that exchanges the refresh token for a new pair on 401 and
//! replays the request once. Refreshes are single-flight so a burst of parallel
//! calls produces one `/auth/refresh`, not twenty.

use crate::config;
use crate::store::{Session, SessionStore};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("network error: {0}")]
    Network(String),
    #[error("not authenticated")]
    Unauthorized,
    #[error("{message}")]
    Api {
        status: u16,
        code: Option<String>,
        message: String,
    },
    #[error("bad response: {0}")]
    Decode(String),
}

impl serde::Serialize for ApiError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("ApiError", 4)?;
        let (kind, status, code) = match self {
            ApiError::Network(_) => ("network", 0u16, None),
            ApiError::Unauthorized => ("unauthorized", 401, None),
            ApiError::Api { status, code, .. } => ("api", *status, code.clone()),
            ApiError::Decode(_) => ("decode", 0, None),
        };
        st.serialize_field("kind", kind)?;
        st.serialize_field("status", &status)?;
        st.serialize_field("code", &code)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Deserialize)]
struct TokenPair {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "userId")]
    user_id: Option<String>,
}

/// Server error envelope. The Android client maps `code` to a localized string
/// via the `api_error_*` resources, so we surface it verbatim to the UI.
#[derive(Debug, Default, Deserialize)]
struct ErrorBody {
    code: Option<String>,
    message: Option<String>,
    error: Option<String>,
}

pub struct Api {
    client: Client,
    session: RwLock<Session>,
    store: SessionStore,
    refresh_lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RequestSpec {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: Option<Value>,
    #[serde(default)]
    pub body: Option<Value>,
}

impl Api {
    pub fn new(store: SessionStore) -> Arc<Self> {
        let session = store.load();
        let client = Client::builder()
            .user_agent(concat!("NanogramPC/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            // Keep sockets warm; the feed fires many small calls.
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .build()
            .expect("failed to build http client");

        Arc::new(Self {
            client,
            session: RwLock::new(session),
            store,
            refresh_lock: Mutex::new(()),
        })
    }

    pub async fn session(&self) -> Session {
        self.session.read().await.clone()
    }

    pub async fn is_logged_in(&self) -> bool {
        self.session.read().await.is_logged_in()
    }

    pub async fn clear_session(&self) {
        self.store.delete();
        self.session.write().await.clear();
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", config::API_BASE, path.trim_start_matches('/'))
    }

    /// Perform a request, refreshing credentials when needed.
    pub async fn request(&self, spec: &RequestSpec) -> ApiResult<Value> {
        let needs_auth = !config::is_unauthenticated_path(&spec.path);

        if needs_auth {
            // Proactive refresh: cheaper than eating a 401 round trip.
            let session = self.session.read().await.clone();
            if session.is_logged_in() && session.access_expired(60) {
                self.refresh().await?;
            }
        }

        let response = self.send(spec, needs_auth).await?;
        if response.0 != StatusCode::UNAUTHORIZED || !needs_auth {
            return Self::finish(response).await;
        }

        // 401: refresh once, then replay.
        self.refresh().await?;
        let retried = self.send(spec, true).await?;
        Self::finish(retried).await
    }

    async fn send(
        &self,
        spec: &RequestSpec,
        needs_auth: bool,
    ) -> ApiResult<(StatusCode, reqwest::Response)> {
        let method = Method::from_bytes(spec.method.to_uppercase().as_bytes())
            .map_err(|_| ApiError::Network(format!("bad method {}", spec.method)))?;

        let mut req = self.client.request(method, self.url(&spec.path));

        if let Some(Value::Object(map)) = &spec.query {
            let pairs: Vec<(String, String)> = map
                .iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| {
                    let s = match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    (k.clone(), s)
                })
                .collect();
            req = req.query(&pairs);
        }

        if let Some(body) = &spec.body {
            req = req.json(body);
        }

        if needs_auth {
            if let Some(token) = self.session.read().await.access_token.clone() {
                req = req.bearer_auth(token);
            }
        }

        let resp = req
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Ok((resp.status(), resp))
    }

    async fn finish((status, resp): (StatusCode, reqwest::Response)) -> ApiResult<Value> {
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        if status.is_success() {
            if bytes.is_empty() {
                return Ok(Value::Null);
            }
            return serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(format!("{e}")));
        }

        if status == StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }

        let err: ErrorBody = serde_json::from_slice(&bytes).unwrap_or_default();
        let message = err
            .message
            .or(err.error.clone())
            .unwrap_or_else(|| format!("Request failed ({})", status.as_u16()));
        Err(ApiError::Api {
            status: status.as_u16(),
            code: err.code,
            message,
        })
    }

    /// Exchange the refresh token for a new pair. Concurrent callers wait on the
    /// first one rather than each burning a refresh token.
    pub async fn refresh(&self) -> ApiResult<()> {
        let before = self.session.read().await.access_token.clone();
        let _guard = self.refresh_lock.lock().await;

        // Someone else refreshed while we waited for the lock.
        if self.session.read().await.access_token != before {
            return Ok(());
        }

        let refresh_token = self
            .session
            .read()
            .await
            .refresh_token
            .clone()
            .ok_or(ApiError::Unauthorized)?;

        let resp = self
            .client
            .post(self.url("auth/refresh"))
            .json(&serde_json::json!({ "refreshToken": refresh_token }))
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            // Refresh token is dead — drop the session so the UI shows login.
            self.clear_session().await;
            return Err(ApiError::Unauthorized);
        }

        let pair: TokenPair = resp
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.to_string()))?;

        self.apply_tokens(pair.access_token, pair.refresh_token, pair.user_id)
            .await;
        Ok(())
    }

    async fn apply_tokens(&self, access: String, refresh: String, user_id: Option<String>) {
        let mut session = self.session.write().await;
        session.access_token = Some(access);
        session.refresh_token = Some(refresh);
        if user_id.is_some() {
            session.user_id = user_id;
        }
        self.store.save(&session);
    }

    /// Store the token pair returned by a login endpoint.
    pub async fn adopt_token_pair(&self, value: &Value) -> ApiResult<()> {
        let pair: TokenPair = serde_json::from_value(value.clone())
            .map_err(|e| ApiError::Decode(format!("login response: {e}")))?;
        self.apply_tokens(pair.access_token, pair.refresh_token, pair.user_id)
            .await;
        Ok(())
    }

    /// Access token for the game webview, refreshed if stale.
    pub async fn access_token_for_webview(&self) -> Option<String> {
        if self.is_logged_in().await && self.session.read().await.access_expired(60) {
            let _ = self.refresh().await;
        }
        self.session.read().await.access_token.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_bootstrap_paths_skip_bearer() {
        assert!(config::is_unauthenticated_path("v2/auth/email/verify"));
        assert!(config::is_unauthenticated_path("auth/refresh"));
        assert!(!config::is_unauthenticated_path("v2/me"));
        assert!(!config::is_unauthenticated_path("v2/games/feed"));
    }

    #[test]
    fn error_serializes_with_kind_and_status() {
        let e = ApiError::Api {
            status: 429,
            code: Some("rate_limited".into()),
            message: "Slow down".into(),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "api");
        assert_eq!(v["status"], 429);
        assert_eq!(v["code"], "rate_limited");
        assert_eq!(v["message"], "Slow down");
    }
}
