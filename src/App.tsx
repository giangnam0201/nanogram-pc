import { useEffect } from 'preact/hooks';
import { listen } from '@tauri-apps/api/event';
import {
  loggedIn,
  me,
  needsOnboarding,
  refreshSession,
  route,
  toasts,
  unreadChats,
  unreadNotifications,
} from './lib/store';
import { notifications as notificationsApi } from './lib/api';
import { isTauri } from './lib/transport';
import { primeCdnSession } from './lib/transport.web';
import { NavBar } from './components/NavBar';
import { FullSpinner } from './components/common';
import { HomeScreen } from './screens/Home';
import { DiscoverScreen } from './screens/Discover';
import { CreateScreen } from './screens/Create';
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
    case 'settings':
      return <SettingsScreen />;
    case 'notifications':
      return <NotificationsScreen />;
    case 'leaderboard':
      return <LeaderboardScreen />;
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
    // The web build needs first-party media cookies before images load.
    if (!isTauri) void primeCdnSession();
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
