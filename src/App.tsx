import { useEffect } from 'preact/hooks';
import { listen } from '@tauri-apps/api/event';
import {
  loggedIn,
  me,
  navigate,
  needsOnboarding,
  refreshSession,
  route,
  toast,
  toasts,
  unreadChats,
  unreadNotifications,
} from './lib/store';
import { localRefreshToken, rooms as roomsApi, roomsAvailable } from './lib/rooms';
import { notifications as notificationsApi } from './lib/api';
import { isTauri } from './lib/transport';
import { NavBar } from './components/NavBar';
import { FullSpinner } from './components/common';
import { HomeScreen } from './screens/Home';
import { DiscoverScreen } from './screens/Discover';
import { CreateScreen } from './screens/Create';
import { MultiCreatorScreen } from './screens/MultiCreator';
import { RoomScreen } from './screens/Room';
import { InboxScreen } from './screens/Inbox';
import { ProfileScreen } from './screens/Profile';
import { LoginScreen } from './screens/Login';
import { OnboardingScreen } from './screens/Onboarding';
import { GameScreen } from './screens/Game';
import { UserScreen } from './screens/User';
import { GenreScreen } from './screens/Genre';
import { ChatScreen } from './screens/Chat';
import { SessionScreen } from './screens/Session';
import { SettingsScreen } from './screens/Settings';
import { NotificationsScreen } from './screens/Notifications';
import { LeaderboardScreen } from './screens/Leaderboard';
import { CreditsScreen } from './screens/Credits';

function Routes() {
  const r = route.value;
  switch (r.name) {
    case 'tab':
      switch (r.tab) {
        case 'home':
          return <HomeScreen />;
        case 'discover':
          return <DiscoverScreen />;
        case 'create':
          return <CreateScreen />;
        case 'rooms':
          return <MultiCreatorScreen />;
        case 'inbox':
          return <InboxScreen />;
        case 'profile':
          return <ProfileScreen />;
      }
      return null;
    case 'game':
      return <GameScreen gameId={r.gameId} />;
    case 'user':
      return <UserScreen userId={r.userId} />;
    case 'genre':
      return <GenreScreen genreId={r.genreId} title={r.title} />;
    case 'chat':
      return <ChatScreen chatId={r.chatId} />;
    case 'session':
      return <SessionScreen sessionId={r.sessionId} />;
    case 'room':
      return <RoomScreen roomId={r.roomId} />;
    case 'settings':
      return <SettingsScreen />;
    case 'notifications':
      return <NotificationsScreen />;
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'credits':
      return <CreditsScreen />;
  }
}

function Toasts() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  useEffect(() => {
    void refreshSession();
    // Desktop OAuth completes in a separate window and signals back over IPC;
    // there is no such event (or IPC) in the browser.
    if (!isTauri) return;
    const un = listen('nanogram://session-changed', () => void refreshSession());
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Keep the nav badges live without hammering the API.
  useEffect(() => {
    if (!loggedIn.value) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await notificationsApi.unreadCount();
        if (alive) unreadNotifications.value = res.count ?? 0;
      } catch {
        /* badge is cosmetic — stay quiet */
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [loggedIn.value]);

  useEffect(() => {
    unreadChats.value = me.value?.chatUnreadCount ?? 0;
  }, [me.value?.chatUnreadCount]);

  /* Rooms build on the room owner's Nanogram session, so the server needs that
     account's sign-in. Linking it here means a room simply works instead of
     failing later with nothing the owner can act on, and re-linking on every
     load keeps the stored copy current if Nanogram rotates refresh tokens.

     Only the browser build holds a refresh token; the desktop build keeps it
     in Rust and never exposes it, so there is nothing to link there. */
  useEffect(() => {
    if (!loggedIn.value || needsOnboarding.value || !roomsAvailable) return;
    const refreshToken = localRefreshToken();
    if (!refreshToken) return;
    void roomsApi.linkToken(refreshToken).catch(() => {
      /* Not fatal: without it a room falls back to building in each member's
         own session. Room settings reports the state. */
    });
  }, [loggedIn.value, needsOnboarding.value, me.value?.id]);

  /* A room invite link (…/?join=ABC123) drops the recipient straight into the
     room once they are signed in. The code is consumed from the URL either way,
     so a refresh does not try to re-join. */
  useEffect(() => {
    if (!loggedIn.value || needsOnboarding.value || !roomsAvailable) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('join');
    if (!code) return;

    params.delete('join');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));

    void roomsApi
      .join(code)
      .then((res) => navigate({ name: 'room', roomId: res.room.id }))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'That invite did not work.', 'error'));
  }, [loggedIn.value, needsOnboarding.value]);

  if (loggedIn.value === null) return <FullSpinner />;
  if (!loggedIn.value) return <LoginScreen />;
  if (needsOnboarding.value) return <OnboardingScreen />;

  return (
    <div class="app">
      <main class="app-main">
        <Routes />
      </main>
      <NavBar />
      <Toasts />
    </div>
  );
}
