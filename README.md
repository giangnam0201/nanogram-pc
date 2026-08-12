# Nanogram PC

**TikTok-style gaming platform for desktop** — play, create, remix, and share short games.  
Built with Jetpack Compose Multiplatform — same UI framework as the Android original.  
Produces a **standalone native `.exe`** (no browser, no Electron).

Forked from **Nanogram for Android** (`app.nanogram.alpha` v1.1.0, APKPure XAPK).

## What is Nanogram?

Nanogram is a social gaming platform:
- **Home Feed** — TikTok-style vertical scroll of short games
- **Play** games — Blast, Puzzle, Racing, AI-generated, and more
- **Remix** — put your own twist on any game
- **Create** — generate games with AI (GameGen)
- **Inbox** — chat with other players
- **Profile** — follow creators, showcase your games

## Download

Prebuilt native executables on [Releases](https://github.com/giangnam0201/nanogram-pc/releases).

| Platform | File |
|----------|------|
| Windows x64 | `nanogram-pc-windows-x64.exe` |
| macOS | `nanogram-pc-macos.dmg` |
| Linux | `nanogram-pc-linux.deb` |

## Build from source

### Requirements
- JDK 21+
- Gradle 8.12 (auto-downloaded via wrapper)

```bash
git clone https://github.com/giangnam0201/nanogram-pc.git
cd nanogram-pc
./gradlew createDistributable
```

Output goes to `build/compose/binaries/main/`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| UI Framework | Jetpack Compose Multiplatform (same as Android) |
| Language | Kotlin |
| HTTP Client | Ktor |
| JSON | kotlinx.serialization |
| Image Loading | Coil |
| Build System | Gradle |

## API Endpoints (from APK)

```
api.nanogram.app/
  /games/feed               — Home feed
  /games/search?q=          — Search games
  /games/{id}               — Game details
  /games/{id}/like          — Like game
  /games/remix              — Remix game
  /games/{id}/comments      — Comments
  /v2/gamegen/sessions      — AI game generation
  /users/{id}               — User profile
  /users/{id}/follow        — Follow user
  /inbox                     — Messages
  /auth/email                — Email login
  /auth/verify               — OTP verification

games.nanogram.app/
  /games/{id}               — Playable HTML5 game

pictures.nanogram.app/      — Image CDN
```

## Project Structure

```
src/main/kotlin/app/nanogram/pc/
├── Main.kt                  — Entry point
├── App.kt                   — Main app composable
├── screens/
│   ├── HomeScreen.kt        — TikTok-style feed
│   ├── DiscoverScreen.kt    — Search/discover
│   ├── CreateScreen.kt      — Game creation
│   ├── InboxScreen.kt       — Messaging
│   └── ProfileScreen.kt     — User profile
├── components/
│   └── Components.kt        — NavBar, GameCard, ChatBubble
├── api/
│   └── ApiClient.kt         — Ktor HTTP client
├── model/
│   └── Models.kt            — Data classes
└── theme/
    └── Theme.kt             — Material 3 dark theme
```

## License

MIT — see [LICENSE](LICENSE).
