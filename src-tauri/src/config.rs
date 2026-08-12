//! Endpoints and constants lifted from the Nanogram Android client (v1.1.0, build 368).

/// Base REST API. Matches `https://api.nanogram.app/` in the APK.
pub const API_BASE: &str = "https://api.nanogram.app/";

/// Games are static web bundles: `{GAMES_BASE}{gameId}/game/index.html`.
pub const GAMES_BASE: &str = "https://games.nanogram.app/games/";

/// Public invite/share links.
pub const INVITE_BASE: &str = "https://nanogram.app/invite/";

/// Web client id used by the Android app for Google sign-in.
pub const GOOGLE_CLIENT_ID: &str =
    "836741523444-qiqmtcvqolnd5i4mf2kbdc6ecm0h3pc2.apps.googleusercontent.com";

/// The Android client sends no `Authorization` header on these paths; the
/// server rejects requests that carry a stale bearer token to them.
pub const UNAUTHENTICATED_PATHS: &[&str] = &[
    "auth/login",
    "auth/refresh",
    "auth/google",
    "auth/email/request",
    "auth/email/verify",
];

/// Share URL for a game, as built by the Android share sheet.
pub fn game_share_url(game_id: &str) -> String {
    format!("https://nanogram.app/game/{game_id}")
}

/// Playable URL for a game bundle.
pub fn game_play_url(game_id: &str) -> String {
    format!("{GAMES_BASE}{game_id}/game/index.html")
}

pub fn is_unauthenticated_path(path: &str) -> bool {
    UNAUTHENTICATED_PATHS.iter().any(|p| path.contains(p))
}
