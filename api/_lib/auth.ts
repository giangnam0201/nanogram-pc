/* Identify the caller from their Nanogram token.
 *
 * The client cannot simply tell us who it is — a room would then be trivially
 * impersonatable by anyone who knows a user id. Instead we replay the caller's
 * bearer token against Nanogram's own /v2/me. If Nanogram accepts it, the
 * identity in the response is real; if not, the request is rejected.
 *
 * That costs one upstream call per request, so verified identities are cached
 * briefly against a hash of the token.
 */

import { getJson, setJson } from './store';

const ME_ENDPOINT = 'https://api.nanogram.app/v2/me';
const CACHE_SECS = 120;

export interface Identity {
  id: string;
  username: string;
  avatarUrl: string | null;
}

/** Cache key that never contains the token itself. */
async function tokenKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `auth:${hex}`;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function bearer(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AuthError('missing authorization', 401);
  return token;
}

export async function identify(req: Request): Promise<Identity> {
  const token = bearer(req);
  const key = await tokenKey(token);

  const cached = await getJson<Identity>(key);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(ME_ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    // Reaching Nanogram failed outright. That is an upstream/network fault, not
    // a bad token, and must not be reported as one.
    const detail = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : '';
    throw new AuthError(`could not reach Nanogram to verify your session${detail ? ` (${detail})` : ''}`, 503);
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError('not authenticated', 401);
  }
  if (!res.ok) {
    throw new AuthError('could not verify identity', 502);
  }

  const me = (await res.json()) as {
    id?: string;
    username?: string;
    avatarUrl?: string | null;
    profilePictureUrl?: string | null;
  };
  if (!me.id) throw new AuthError('not authenticated', 401);

  const identity: Identity = {
    id: me.id,
    username: me.username ?? 'someone',
    avatarUrl: me.avatarUrl ?? me.profilePictureUrl ?? null,
  };
  await setJson(key, identity, CACHE_SECS);
  return identity;
}

/* -------------------------------------------------------------- replies --- */

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Turn a thrown value into the right response. */
export function fail(e: unknown): Response {
  if (e instanceof AuthError) return json({ error: e.message }, e.status);
  const message = e instanceof Error ? e.message : 'unexpected error';
  return json({ error: message }, 500);
}
