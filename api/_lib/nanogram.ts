/* Server-side calls to Nanogram on a delegated host's behalf.
 *
 * Only used for rooms whose host explicitly armed "keep building while I'm
 * away". Everything else runs from the member's own browser with their own
 * token, and never passes through here.
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
import { clearDelegation, getDelegation, setDelegation, type Room } from './rooms';

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
 * A usable access token for this room's host, refreshing only when the cached
 * one is close to expiry.
 */
export async function delegatedAccessToken(roomId: string): Promise<string> {
  const cached = await getJson<{ token: string }>(`room:${roomId}:deleg:access`);
  if (cached?.token) {
    const exp = expiresAt(cached.token);
    if (exp === null || Date.now() / 1000 + 90 < exp) return cached.token;
  }

  const delegation = await getDelegation(roomId);
  if (!delegation) throw new DelegationFailed('this room has no offline permission');

  if (Date.parse(delegation.expiresAt) < Date.now()) {
    await clearDelegation(roomId);
    throw new DelegationFailed('the host’s offline permission has expired');
  }

  const refreshToken = await decryptSecret(delegation.refreshToken);
  if (!refreshToken) {
    // Key rotated, or the blob is corrupt. Either way it can never be used.
    await clearDelegation(roomId);
    throw new DelegationFailed('stored host credentials could not be read');
  }

  let pair: TokenPair;
  try {
    pair = await refreshPair(refreshToken);
  } catch (e) {
    await clearDelegation(roomId);
    throw e;
  }

  // Persist the rotated refresh token, or the next refresh fails.
  if (pair.refreshToken !== refreshToken) {
    await setDelegation(roomId, {
      ...delegation,
      refreshToken: await encryptSecret(pair.refreshToken),
    });
  }

  const exp = expiresAt(pair.accessToken);
  const ttl = exp ? Math.max(60, Math.floor(exp - Date.now() / 1000 - 60)) : 600;
  await setJson(`room:${roomId}:deleg:access`, { token: pair.accessToken }, ttl);
  return pair.accessToken;
}

/** Drop the cached access token — used when the host re-arms delegation. */
export async function dropCachedAccess(roomId: string): Promise<void> {
  await cmd('DEL', `room:${roomId}:deleg:access`);
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

/** True when this room can build without any member present. */
export async function canBuildOffline(room: Room): Promise<boolean> {
  if (!room.delegated) return false;
  const delegation = await getDelegation(room.id);
  return Boolean(delegation) && Date.parse(delegation!.expiresAt) > Date.now();
}
