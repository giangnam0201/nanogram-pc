//! OAuth helpers.
//!
//! Nanogram's own flows are reused verbatim: Discord uses the `discordClientId`
//! / `discordRedirectUri` the server hands back from `GET /config`, and the
//! resulting `code` is posted to `auth/discord` exactly as the Android client
//! does. Google uses the same web client id the APK ships with.
//!
//! On desktop we cannot receive an Android deep link, so the authorize page is
//! opened in a webview window and we watch for navigation to the registered
//! redirect URI, lifting `code` off the query string before the page commits.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub fn random_urlsafe(len: usize) -> String {
    let bytes: Vec<u8> = (0..len).map(|_| rand::thread_rng().gen()).collect();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE pair: (verifier, S256 challenge).
pub fn pkce_pair() -> (String, String) {
    let verifier = random_urlsafe(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Parse the query string of a redirect URL into a map.
pub fn parse_query(url_str: &str) -> HashMap<String, String> {
    match url::Url::parse(url_str) {
        Ok(u) => u
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect(),
        Err(_) => HashMap::new(),
    }
}

/// True when `candidate` is the redirect we are waiting for, ignoring query and
/// fragment. Compared on scheme+host+port+path so an extra `state` param or a
/// trailing slash does not break detection.
pub fn is_redirect_match(candidate: &str, redirect_uri: &str) -> bool {
    let (Ok(a), Ok(b)) = (url::Url::parse(candidate), url::Url::parse(redirect_uri)) else {
        return false;
    };
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
        && a.path().trim_end_matches('/') == b.path().trim_end_matches('/')
}

pub struct LoopbackCapture {
    pub port: u16,
    listener: TcpListener,
}

const DONE_PAGE: &str = "\
<!doctype html><html><head><meta charset=utf-8><title>Nanogram</title>
<style>html{background:#0d0d0d;color:#fff;font:16px/1.5 system-ui;display:grid;place-items:center;height:100%}
div{text-align:center}b{color:#c4ee74}</style></head>
<body><div><h2><b>Nanogram</b></h2><p>You're signed in. You can close this tab.</p></div></body></html>";

impl LoopbackCapture {
    /// Bind an ephemeral port on loopback to receive an OAuth redirect.
    pub async fn bind() -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        Ok(Self { port, listener })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    /// Wait for the browser to hit the loopback redirect and return its query
    /// parameters. Times out so a cancelled sign-in doesn't leak the task.
    pub async fn wait(self, timeout: std::time::Duration) -> Option<HashMap<String, String>> {
        tokio::time::timeout(timeout, async move {
            loop {
                let (mut stream, _) = self.listener.accept().await.ok()?;
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.ok()?;
                let head = String::from_utf8_lossy(&buf[..n]).to_string();

                // "GET /callback?code=... HTTP/1.1"
                let target = head
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");

                if !target.starts_with("/callback") {
                    let _ = stream
                        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                        .await;
                    continue;
                }

                let params = parse_query(&format!("http://127.0.0.1{target}"));
                let body = DONE_PAGE.as_bytes();
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.write_all(body).await;
                let _ = stream.flush().await;
                return Some(params);
            }
        })
        .await
        .ok()
        .flatten()
    }
}

/// Build the Discord authorize URL using the server-provided client id.
pub fn discord_authorize_url(client_id: &str, redirect_uri: &str, state: &str) -> String {
    let mut u = url::Url::parse("https://discord.com/oauth2/authorize").expect("static url");
    u.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "identify email")
        .append_pair("state", state)
        .append_pair("prompt", "consent");
    u.to_string()
}

/// Build the Google authorize URL. `id_token` is what `v2/auth/google` expects.
pub fn google_authorize_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
    nonce: &str,
) -> String {
    let mut u = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").expect("static url");
    u.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", state)
        .append_pair("nonce", nonce)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "select_account");
    u.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let (v, c) = pkce_pair();
        assert_eq!(c, URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes())));
        assert!(!v.contains('=') && !c.contains('='));
    }

    #[test]
    fn redirect_match_ignores_query_and_trailing_slash() {
        let want = "https://api.nanogram.app/auth/discord/callback";
        assert!(is_redirect_match(
            "https://api.nanogram.app/auth/discord/callback?code=abc&state=xy",
            want
        ));
        assert!(is_redirect_match(
            "https://api.nanogram.app/auth/discord/callback/",
            want
        ));
        assert!(!is_redirect_match("https://discord.com/oauth2/authorize", want));
        assert!(!is_redirect_match(
            "https://evil.example/auth/discord/callback?code=abc",
            want
        ));
    }

    #[test]
    fn extracts_code_from_redirect() {
        let q = parse_query("http://127.0.0.1:5000/callback?code=xyz&state=s1");
        assert_eq!(q.get("code").map(String::as_str), Some("xyz"));
        assert_eq!(q.get("state").map(String::as_str), Some("s1"));
    }

    #[test]
    fn authorize_urls_carry_required_params() {
        let d = discord_authorize_url("123", "https://x.test/cb", "st");
        assert!(d.starts_with("https://discord.com/oauth2/authorize?"));
        assert!(d.contains("client_id=123") && d.contains("response_type=code"));

        let g = google_authorize_url("cid", "http://127.0.0.1:1/callback", "st", "ch", "nc");
        assert!(g.contains("code_challenge_method=S256"));
        assert!(g.contains("scope=openid+email+profile") || g.contains("scope=openid%20email%20profile"));
    }
}
