//! Persistent session storage.
//!
//! Mirrors the Android `TokenStore`: an access token, a refresh token and the
//! user id, with expiry derived from the JWT payload so we can refresh before
//! the server hands us a 401.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Session {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
}

impl Session {
    pub fn is_logged_in(&self) -> bool {
        self.refresh_token.is_some()
    }

    /// True when the access token is missing, unreadable, or within `skew_secs`
    /// of expiring. The Android client refreshes on the same condition.
    pub fn access_expired(&self, skew_secs: i64) -> bool {
        match self.access_token.as_deref() {
            None => true,
            Some(t) => match jwt_exp(t) {
                Some(exp) => now_secs() + skew_secs >= exp,
                // Opaque token: let the 401 path handle it.
                None => false,
            },
        }
    }

    pub fn clear(&mut self) {
        self.access_token = None;
        self.refresh_token = None;
        self.user_id = None;
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Read the `exp` claim without verifying the signature — we only use it to
/// decide *when* to refresh, never to make a trust decision.
pub fn jwt_exp(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("exp")?.as_i64()
}

pub struct SessionStore {
    path: PathBuf,
}

impl SessionStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("session.json"),
        }
    }

    pub fn load(&self) -> Session {
        std::fs::read(&self.path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, session: &Session) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_vec_pretty(session) {
            let _ = std::fs::write(&self.path, json);
            self.restrict_permissions();
        }
    }

    pub fn delete(&self) {
        let _ = std::fs::remove_file(&self.path);
    }

    #[cfg(unix)]
    fn restrict_permissions(&self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
    }

    #[cfg(not(unix))]
    fn restrict_permissions(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_with_exp(exp: i64) -> String {
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{exp}}}"#));
        format!("header.{payload}.sig")
    }

    #[test]
    fn reads_exp_from_jwt() {
        assert_eq!(jwt_exp(&token_with_exp(1234)), Some(1234));
        assert_eq!(jwt_exp("not-a-jwt"), None);
    }

    #[test]
    fn treats_soon_to_expire_token_as_expired() {
        let s = Session {
            access_token: Some(token_with_exp(now_secs() + 10)),
            refresh_token: Some("r".into()),
            user_id: None,
        };
        assert!(s.access_expired(60));
        assert!(!s.access_expired(5));
    }

    #[test]
    fn missing_access_token_is_expired() {
        assert!(Session::default().access_expired(0));
    }
}
