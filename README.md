# Nanogram for Desktop

A native desktop client for **Nanogram** — play, create, remix and share instant
games — for Windows, macOS and Linux.

Ported from the Android app (`app.nanogram.alpha` 1.1.0, build 368) against the
same production backend. Not a wrapper around a website, and not a mock: every
screen talks to `api.nanogram.app` using the app's own endpoints and its own
login flow.

## What it does

| Area | Status |
|------|--------|
| Sign in with email code (Nanogram's own OTP flow) | ✅ |
| Sign in with Google / Discord | ✅ (see notes) |
| Onboarding — username, date of birth, referral | ✅ |
| Home feed — vertical scroll, play in place, view reporting | ✅ |
| Like · save · share · comment (with replies and likes) | ✅ |
| Share to a friend in-app, copy link, external targets | ✅ |
| Discover — sections, genres, game & creator search | ✅ |
| Leaderboard — today / this week / all time | ✅ |
| Create — GameGen sessions, live preview, publish, revert | ✅ |
| Drafts, credits, in-flight generation recovery | ✅ |
| Inbox — chats, requests, send games, block/report | ✅ |
| Notifications with unread badges | ✅ |
| Profiles — yours and other people's, follow, rename, delete | ✅ |
| Settings, feedback, invite links | ✅ |

## Install

Grab a build from [Releases](https://github.com/giangnam0201/nanogram-pc/releases):

| Platform | File |
|----------|------|
| Windows 10/11 x64 | `.exe` installer or `.msi` |
| macOS (Apple Silicon) | `-aarch64.dmg` |
| macOS (Intel) | `-x64.dmg` |
| Linux | `.deb` or `.AppImage` |

Windows needs the Edge WebView2 runtime, which ships with Windows 10 21H2 and
later. Linux needs `libwebkit2gtk-4.1`.

## How it's built

```
nanogram.exe                     one native binary, no JVM, no Electron
├── native window                Win32 / Cocoa / GTK
├── Rust core                    network, session, token refresh
└── system webview               WebView2 · WKWebView · WebKitGTK
    ├── the Nanogram UI
    └── games from games.nanogram.app
```

**The UI never holds a token.** The webview asks Rust for an endpoint by name;
Rust attaches credentials, refreshes them and hands back JSON. Access tokens
stay in the native process.

**Auth mirrors the Android client exactly.** A bearer token goes on every
request except the five auth bootstrap paths. A 401 triggers one refresh and one
replay, and refreshes are single-flight so a burst of parallel calls produces a
single `/auth/refresh`. Tokens are also refreshed proactively by reading the
JWT `exp` claim, which avoids most 401 round trips entirely.

**Games run the same way they do on Android.** Android keeps a pool of WebViews
and only runs the visible game; the feed here mounts exactly one frame at a
time, so memory stays flat however far you scroll. Games are sandboxed and
cannot reach the shell's IPC.

Roughly 10 MB installed, ~80 MB RSS idle.

## Where the port came from

The APK was decompiled and the client contract recovered from it. The results
are checked in so the port is auditable rather than guesswork:

- `docs/api-endpoints.txt` — ~120 endpoints across 21 Retrofit services, with
  verbs, paths and parameter names
- `docs/api-dto-schema.json` — 174 DTOs with exact field names and optionality,
  read out of the kotlinx-serialization descriptors
- `docs/tools_vd2svg.py` — the VectorDrawable → SVG converter used for the icons

Assets are the originals from the APK: 92 icons, all eight Mona Sans weights,
and 700 strings from `strings.xml`, so the wording matches the phone app. The
app is dark-only because Android forces night mode in `attachBaseContext`.

## Build from source

Requires Node 22+ and a Rust toolchain.

```bash
npm ci
npx tauri icon src/assets/img/app_icon.png   # once
npm run app          # dev
npm run app:build    # release bundle
```

CI builds all four targets on every push; tagging `v*` publishes a release.

## Notes

- **Google and Discord sign-in** use Nanogram's own OAuth credentials — Discord's
  come from the server's `/config`, and Google's is the client id from the APK.
  Both providers validate redirect URIs against Nanogram's server-side
  allowlist, which only lists Android/web targets. If a provider rejects the
  desktop redirect, that is a server-side registration matter and cannot be
  fixed in this client. **Email sign-in works unconditionally** and is the
  recommended path.
- Push notifications are Android-specific (FCM) and are not ported; the app
  polls for unread counts instead.
- Genre and welcome card artwork from the APK is not bundled, since those
  screens use text and icons here. It can be added back if the layouts need it.

## Licence

See [LICENSE](LICENSE). Nanogram, its API and its assets belong to their owners;
this is an unofficial client.
