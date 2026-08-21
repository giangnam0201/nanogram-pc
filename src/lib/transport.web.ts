/* Browser transport. Talks to api.nanogram.app directly — it answers
   `Access-Control-Allow-Origin: *` and permits the Authorization header, so no
   proxy is needed for data. Only CloudFront-signed media needs help, and that
   goes through /api/cdn (see api/cdn/[...path].ts). */

import {
  API_BASE,
  apiError,
  buildUrl,
  isUnauthenticatedPath,
  readError,
  type RequestSpec,
  type SessionState,
  type Transport,
} from './transport';
import { consumeDiscordCode, googleIdToken, startDiscord } from './oauth.web';

const STORAGE_KEY = 'nanogram.session';

interface StoredSession {
  accessToken?: string | null;
  refreshToken?: string | null;
  userId?: string | null;
}

function load(): StoredSession {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as StoredSession;
  } catch {
    return {};
  }
}

function save(session: StoredSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clear() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Read `exp` without verifying — only used to decide when to refresh. */
function expiresAt(token?: string | null): number | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function accessExpired(session: StoredSession, skewSecs = 60): boolean {
  if (!session.accessToken) return true;
  const exp = expiresAt(session.accessToken);
  if (exp === null) return false;
  return Date.now() / 1000 + skewSecs >= exp;
}

/** Single-flight refresh, matching the desktop client. */
let refreshing: Promise<void> | null = null;

/* Once this browser has linked its sign-in for Multi-Creator, the server holds
   the session and is the only party allowed to refresh it.

   Nanogram rotates refresh tokens: refreshing retires the token used. If both
   the server and this browser refreshed, whichever went second would present a
   retired token and be signed out — which, with a short access-token lifetime,
   happens within minutes. So when a link exists we ask the server for an access
   token instead of refreshing here, and there is exactly one refresher.

   Falls through to the normal flow if the link is gone or unreachable. */
const LINK_KEY = 'nanogram.roomLink';

interface RoomLink {
  userId: string;
  secret: string;
}

export function saveRoomLink(link: RoomLink | null) {
  if (link) localStorage.setItem(LINK_KEY, JSON.stringify(link));
  else localStorage.removeItem(LINK_KEY);
}

function loadRoomLink(): RoomLink | null {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    if (!raw) return null;
    const link = JSON.parse(raw) as RoomLink;
    return link.userId && link.secret ? link : null;
  } catch {
    return null;
  }
}

/** Ask the server for an access token from the session it holds. */
async function refreshViaServer(link: RoomLink): Promise<boolean> {
  const base = (import.meta.env.VITE_ROOMS_API ?? '/api').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/session-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(link),
    });
  } catch {
    return false; // offline or endpoint missing — fall back
  }

  if (res.status === 401 || res.status === 404) {
    // The stored session is gone; this browser must sign in again properly.
    saveRoomLink(null);
    return false;
  }
  if (!res.ok) return false;

  const body = (await res.json().catch(() => ({}))) as { accessToken?: string };
  if (!body.accessToken) return false;

  const session = load();
  save({
    accessToken: body.accessToken,
    // Deliberately left as-is: the server owns rotation now, and overwriting
    // this with a stale value would break the link if it is ever needed again.
    refreshToken: session.refreshToken ?? null,
    userId: session.userId ?? link.userId,
  });
  void primeCdnSession();
  return true;
}

async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = load();

    const link = loadRoomLink();
    if (link && (await refreshViaServer(link))) return;

    if (!session.refreshToken) throw apiError('unauthorized', 401, 'not authenticated');

    const res = await fetch(`${API_BASE}auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) {
      clear();
      throw apiError('unauthorized', 401, 'not authenticated');
    }

    const pair = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      userId?: string;
    };
    save({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      userId: pair.userId ?? session.userId ?? null,
    });
    // Media cookies are minted per session; re-arm them after a refresh.
    void primeCdnSession();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function send(spec: RequestSpec, withAuth: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth) {
    const token = load().accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  return fetch(buildUrl(spec.path, spec.query), {
    method: spec.method,
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
  });
}

async function finish<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (res.ok) return (text ? JSON.parse(text) : null) as T;
  if (res.status === 401) throw apiError('unauthorized', 401, 'not authenticated');
  throw readError(res.status, text);
}

async function request<T>(spec: RequestSpec): Promise<T> {
  const needsAuth = !isUnauthenticatedPath(spec.path);

  if (needsAuth) {
    const session = load();
    if (session.refreshToken && accessExpired(session)) {
      await refresh();
    }
  }

  let res = await send(spec, needsAuth);
  if (res.status === 401 && needsAuth) {
    await refresh();
    res = await send(spec, true);
  }
  return finish<T>(res);
}

async function authRequest<T>(spec: RequestSpec): Promise<T> {
  const value = await request<T>(spec);
  const pair = value as unknown as {
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
  };
  if (pair?.accessToken && pair?.refreshToken) {
    save({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      userId: pair.userId ?? null,
    });
    await primeCdnSession();
  }
  return value;
}

/* ----------------------------------------------------------------- cdn --- */

/** Base of the serverless media proxy, or '' when hosted without one. */
export const CDN_PROXY: string = (import.meta.env.VITE_CDN_PROXY ?? '/api').replace(/\/$/, '');

/**
 * Hand the access token to the proxy once, so it can mint CloudFront cookies
 * scoped to this origin. `<img>` and `<iframe>` cannot send an Authorization
 * header, and putting the token in a query string would leak it into history
 * and server logs — a first-party cookie avoids both.
 */
export async function primeCdnSession(): Promise<void> {
  if (!CDN_PROXY) return;

  let session = load();
  if (!session.refreshToken) return;

  // A stale access token would make the exchange 401 and leave media unsigned,
  // so make sure it is current before handing it over.
  if (accessExpired(session)) {
    try {
      await refresh();
    } catch {
      return;
    }
    session = load();
  }

  const token = session.accessToken;
  if (!token) return;
  try {
    await fetch(`${CDN_PROXY}/cdn-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
  } catch {
    /* media will fall back to unsigned requests */
  }
}

/* ---------------------------------------------------------------- oauth --- */

/** Finish a Discord round trip, if this page load is one. */
export async function completeDiscordIfReturning(): Promise<boolean> {
  const returned = consumeDiscordCode();
  if (!returned) return false;
  await authRequest({
    method: 'POST',
    path: 'auth/discord',
    body: { code: returned.code, redirectUri: returned.redirectUri },
  });
  return true;
}

export const webTransport: Transport = {
  request,
  authRequest,

  async sessionState(): Promise<SessionState> {
    const session = load();
    return { loggedIn: !!session.refreshToken, userId: session.userId ?? null };
  },

  async logout() {
    const session = load();
    if (session.refreshToken) {
      try {
        await request({
          method: 'POST',
          path: 'auth/logout',
          body: { refreshToken: session.refreshToken },
        });
      } catch {
        /* local state is cleared regardless */
      }
    }
    clear();
    // The room link points at a session that no longer exists, and leaving it
    // behind would hand the next person to use this browser someone else's.
    saveRoomLink(null);
  },

  async gameUrl(gameId) {
    return `https://games.nanogram.app/games/${gameId}/game/index.html`;
  },
  async shareUrl(gameId) {
    return `https://nanogram.app/game/${gameId}`;
  },
  async inviteUrl(code) {
    return `https://nanogram.app/invite/${code}`;
  },
  async gameToken() {
    return load().accessToken ?? null;
  },

  async loginGoogle() {
    const idToken = await googleIdToken();
    return authRequest({ method: 'POST', path: 'v2/auth/google', body: { idToken } });
  },

  async loginDiscord() {
    // Discord needs its client id from the server, exactly as on Android.
    const cfg = await request<{ discordClientId?: string }>({ method: 'GET', path: 'config' });
    if (!cfg.discordClientId) {
      throw apiError('api', 503, 'Discord sign-in is unavailable right now.');
    }
    return startDiscord(cfg.discordClientId);
  },

  async openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },

  /* The web build has no restrictive CSP of its own, so a blob URL is enough
     to give a generated build its own origin. */
  async stagePreview(html) {
    return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  },
  previewSrc(id) {
    return id;
  },
};
