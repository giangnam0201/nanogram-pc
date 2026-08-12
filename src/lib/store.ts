import { signal, computed } from '@preact/signals';
import { ipc } from './ipc';
import { isTauri } from './transport';
import { primeCdnSession } from './transport.web';
import { profile } from './api';
import type { Me } from './types';

/* ------------------------------------------------------------- routing --- */

export type Tab = 'home' | 'discover' | 'create' | 'inbox' | 'profile';

export type Route =
  | { name: 'tab'; tab: Tab }
  | { name: 'game'; gameId: string }
  | { name: 'user'; userId: string }
  | { name: 'genre'; genreId: string; title: string }
  | { name: 'chat'; chatId: string }
  | { name: 'session'; sessionId: string }
  | { name: 'settings' }
  | { name: 'notifications' }
  | { name: 'leaderboard' };

export const route = signal<Route>({ name: 'tab', tab: 'home' });
const history: Route[] = [];

export function navigate(next: Route) {
  history.push(route.value);
  route.value = next;
}

export function back() {
  const prev = history.pop();
  route.value = prev ?? { name: 'tab', tab: 'home' };
}

export function switchTab(tab: Tab) {
  history.length = 0;
  route.value = { name: 'tab', tab };
}

export const canGoBack = computed(() => history.length > 0);

/* ------------------------------------------------------------- session --- */

export const loggedIn = signal<boolean | null>(null); // null = still checking
export const me = signal<Me | null>(null);
export const meLoading = signal(false);

export const needsOnboarding = computed(() => {
  const user = me.value;
  if (!user) return false;
  // The server tells us; a missing username also means onboarding never ran.
  if (user.onboarding?.completed === false) return true;
  return !user.username;
});

export async function refreshSession() {
  const state = await ipc.sessionState();
  loggedIn.value = state.loggedIn;
  if (state.loggedIn) {
    await loadMe();
    // Browser media needs first-party CloudFront cookies; the desktop build
    // signs requests in Rust instead.
    if (!isTauri) void primeCdnSession();
  } else {
    me.value = null;
  }
}

export async function loadMe() {
  meLoading.value = true;
  try {
    me.value = await profile.me();
  } catch {
    // A failed /v2/me shouldn't blank the app; keep whatever we had.
  } finally {
    meLoading.value = false;
  }
}

export async function signOut() {
  await ipc.logout();
  me.value = null;
  loggedIn.value = false;
  history.length = 0;
  route.value = { name: 'tab', tab: 'home' };
}

/* --------------------------------------------------------------- toasts --- */

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export const toasts = signal<Toast[]>([]);
let toastId = 0;

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3200);
}

/* --------------------------------------------------------------- badges --- */

export const unreadNotifications = signal(0);
export const unreadChats = signal(0);
