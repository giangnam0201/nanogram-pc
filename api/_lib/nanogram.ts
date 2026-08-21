/* Server-side calls to Nanogram on a delegated host's behalf.
 *
 * A room's builds run on the room owner's session, so the room keeps one AI
 * conversation and one credit pool no matter who typed the prompt or who is
 * online. That is what this is for. If the owner has no stored sign-in, the
 * caller falls back to building from their own browser instead.
 *
 * Refresh-token rotation is the sharp edge. Nanogram's /auth/refresh returns a
 * fresh pair, and if it rotates (issues a new refresh token and retires the
 * old one) then whichever party refreshes last owns the session — so a server
 * refresh can log the host out on their own phone. We reduce the blast radius
 * two ways: the derived access token is cached until it nearly expires, so we
 * refresh as rarely as possible, and the host's client re-arms delegation with
 * its current token every time it opens the room.
 */

import { cmd, getJson, setJson } from './store';
import { decryptSecret, encryptSecret } from './crypto';
import {
  clearUserToken,
  getUserSession,
  getUserToken,
  saveUserAccessToken,
  saveUserToken,
  type Room,
} from './rooms';

const API_BASE = 'https://api.nanogram.app/';

export class DelegationFailed extends Error {}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Read `exp` without verifying; only used to decide when to refresh. */
function expiresAt(token: string): number | null {
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

async function refreshPair(refreshToken: string): Promise<TokenPair> {
  const res = await fetch(`${API_BASE}auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new DelegationFailed('the host needs to sign in again');
  const pair = (await res.json()) as Partial<TokenPair>;
  if (!pair.accessToken) throw new DelegationFailed('refresh returned no access token');
  return {
    accessToken: pair.accessToken,
    // Some servers return only an access token and keep the refresh token.
    refreshToken: pair.refreshToken ?? refreshToken,
  };
}

/**
 * A usable access token for one user, from their stored refresh token.
 *
 * Cached against the user so repeated builds in a busy room do not refresh on
 * every prompt — refreshing is the operation that can rotate the token and
 * disturb that person's own session, so it is done as rarely as possible.
 */
export async function accessTokenForUser(userId: string): Promise<string> {
  const session = await getUserSession(userId);
  if (!session) throw new DelegationFailed('no stored sign-in for that account');

  // A cached access token costs nothing and, crucially, does not rotate.
  if (session.accessTokenEnc && session.accessExpiresAt) {
    if (Date.parse(session.accessExpiresAt) - 90_000 > Date.now()) {
      const cached = await decryptSecret(session.accessTokenEnc);
      if (cached) return cached;
    }
  }

  /* A row with no link secret was stored before rotation was handled. Its
     browser is still refreshing on its own, so refreshing here too would retire
     the token underneath it and sign that person out within minutes — which is
     precisely the damage this whole mechanism exists to stop.

     Such a row can never be used safely, so drop it. The browser re-links on
     its next load and comes back with a secret, after which the server is the
     only refresher and this cannot recur. Until then the room falls back to
     each member building in their own session. */
  if (!session.secretHash) {
    await clearUserToken(userId);
    throw new DelegationFailed(
      'that sign-in was stored before token rotation was handled; it will re-link on next load',
    );
  }

  const refreshToken = await decryptSecret(session.refreshTokenEnc);
  if (!refreshToken) {
    // Key rotated, or the blob is corrupt. Either way it can never be used.
    await clearUserToken(userId);
    throw new DelegationFailed('stored sign-in could not be read');
  }

  let pair: TokenPair;
  try {
    pair = await refreshPair(refreshToken);
  } catch (e) {
    await clearUserToken(userId);
    throw e;
  }

  /* Nanogram rotates: the token just used is now dead, so the new one must be
     stored or every later refresh fails. The browser never refreshes once it
     has linked, so this row is the only living copy of the session. */
  if (pair.refreshToken !== refreshToken) {
    await saveUserToken(userId, await encryptSecret(pair.refreshToken));
  }

  const exp = expiresAt(pair.accessToken);
  const expiresIso = new Date(exp ? exp * 1000 : Date.now() + 600_000).toISOString();
  await saveUserAccessToken(userId, await encryptSecret(pair.accessToken), expiresIso);
  return pair.accessToken;
}

/** The token a room builds with: always the room owner's. */
export function roomBuildToken(room: Room): Promise<string> {
  return accessTokenForUser(room.hostId);
}

/** Drop a cached access token — used when someone re-links their sign-in. */
export async function dropCachedAccess(userId: string): Promise<void> {
  await cmd('DEL', `accesstoken:${userId}`);
}

/* ------------------------------------------------------------ requests --- */

async function call<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(new URL(path, API_BASE), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `nanogram ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? message;
    } catch {
      /* keep the status-code message */
    }
    throw new DelegationFailed(message);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export interface GameGenMessageResult {
  userMessage?: { id?: string; content?: string };
  assistantMessage?: { id?: string; content?: string; htmlSnapshot?: string | null };
}

/** Drive the room's build as the host. Assumes quota was already checked. */
export const asHost = {
  createSession: (token: string, body: { styleId: string; dimension?: string; description?: string; remixHtml: string }) =>
    call<{ id: string }>(token, 'POST', 'v2/gamegen/sessions', body),

  sendMessage: (token: string, sessionId: string, text: string) =>
    call<GameGenMessageResult>(token, 'POST', `v2/gamegen/sessions/${sessionId}/messages`, {
      text,
      supportsAskUser: true,
    }),

  messages: (token: string, sessionId: string) =>
    call<{ title?: string | null; remixHtml?: string | null; messages?: { id: string; role: string; content: string; status?: string | null; htmlSnapshot?: string | null }[] }>(
      token,
      'GET',
      `v2/gamegen/sessions/${sessionId}/messages`,
    ),

  credits: (token: string) =>
    call<{ remainingToday?: number | null; bankBalance?: number | null }>(
      token,
      'GET',
      'v2/gamegen/credits',
    ),

  inFlight: (token: string) =>
    call<{ inFlight?: boolean | null; sessionId?: string | null }>(
      token,
      'GET',
      'v2/gamegen/in-flight',
    ),
};

/** Whether this room's builds can run server-side on the owner's session. */
export async function canBuildOnOwner(room: Room): Promise<boolean> {
  return Boolean(await getUserToken(room.hostId));
}
