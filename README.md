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
| **Multi-Creator — build a game together in a live room** | ✅ (web) |

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

## Multi-Creator

A shared room where several people build one game together, with live chat and
a live preview. New in this port — the phone app has no equivalent.

Make a room from the **Rooms** tab, share the six-character code or the
`?join=CODE` link, and everyone in the room sees the same chat, the same build
and the same result. Prompts are attributed, so you can see who asked for what.

**Why it does not use Nanogram's chat API.** It cannot. `POST v2/chats` takes a
single `recipientId`; there is no group, no participant list, and no realtime
transport anywhere in the API (the phone app polls, and the only `WebSocket`
symbols in the APK belong to OkHttp). So rooms run on our own endpoints under
`api/`, styled to match the rest of the app. Nanogram's real API still does
everything it can: identity, credits, the GameGen build itself, and DM-ing a
friend the invite link — that last one being a genuine one-to-one message.

| Piece | How |
|-------|-----|
| Realtime | Supabase Realtime. The `room_events` insert *is* the broadcast, so nothing fans out and an idle room costs nothing |
| Presence | Realtime Presence — ephemeral, never stored, never polled |
| Identity | Every API request replays the caller's token against `v2/me`; a client-claimed user id is never trusted |
| Subscriptions | The server mints a short-lived JWT carrying the verified Nanogram id as an `ng_user` claim; RLS resolves it to decide which rooms may be watched |
| Storage | Supabase Postgres, reached over PostgREST with the service role key — server side only |
| Building | The host's GameGen session — sessions are single-owner, so a member's token gets 403 on it |
| Credits | Real `v2/gamegen/credits`, plus a per-room ceiling the host sets, enforced with an atomic increment |

The browser never holds the service role key and never writes directly: reads
and writes go through `api/`, and the only thing the client does with Supabase
is subscribe. Run `supabase/schema.sql` once to create the tables and policies.

**Building while the host is away** is opt-in per room. It stores the host's
Nanogram refresh token, encrypted with AES-256-GCM under `ROOM_DELEGATION_KEY`,
expiring on its own and deletable at any time. Without that key set, arming it
is refused rather than storing credentials in the clear. It is genuinely
sensitive — a stored refresh token is full account access — so only use it in a
room you trust. The row holding it has no RLS policy at all, so no client key
can reach it; only the service role can.

One caveat worth knowing: if Nanogram rotates refresh tokens, a server-side
refresh can invalidate the host's own session and sign them out on their own
device. The host's client re-arms whenever it opens the room to limit this.

See `.env.example` for configuration. With no Supabase configured, rooms fall
back to an in-process Map and an SSE polling endpoint — fine for local work,
useless on Vercel, and the UI says so when it happens.

## Build from source

Requires Node 22+ and a Rust toolchain.

```bash
npm ci
npx tauri icon src/assets/img/app_icon.png   # once
npm run app          # desktop dev
npm run app:build    # release bundle
```

For the web build — the one Multi-Creator targets — `run-local.ps1` installs
dependencies, starts Vite, and prints a LAN address so you can open the same
session on your phone:

```powershell
.
un-local.ps1            # dev server, hot reload
.
un-local.ps1 -Build     # production build, then preview it
```

The dev server also runs the `api/*` Edge functions locally (see
`vite.dev-api.ts`); plain `vite` does not, and without them every CDN image,
thumbnail and game frame 404s.

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
