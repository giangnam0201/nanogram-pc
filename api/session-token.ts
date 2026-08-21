/* Hand a linked browser a fresh access token.
 *
 *   POST /api/session-token   { userId, secret }
 *
 * Why this exists: Nanogram rotates refresh tokens. Refreshing retires the
 * token used, so two parties holding the same one cannot both survive — a
 * server-side refresh silently kills the browser's session a few minutes
 * later, when it next tries to refresh with a token that no longer works.
 *
 * So once a browser has linked its sign-in, the server becomes the only party
 * that ever refreshes, and the browser asks here instead of calling Nanogram.
 * One refresher, no rotation conflict, nobody gets signed out.
 *
 * This endpoint cannot use the normal bearer auth: it is reached precisely when
 * the caller's access token has expired. It is authorised instead by the secret
 * issued at link time, of which only a SHA-256 is stored — so the database row
 * cannot be used to mint a token, and a leaked secret can be revoked by
 * unlinking.
 */

import { json } from './_lib/auth';
import { canDelegate, hashSecret } from './_lib/crypto';
import { accessTokenForUser, DelegationFailed } from './_lib/nanogram';
import { getUserSession } from './_lib/rooms';

export const config = { runtime: 'edge' };

/** Constant-time compare, so a wrong secret leaks nothing through timing. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!canDelegate) return json({ error: 'not configured' }, 503);

    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      secret?: string;
    };
    const userId = String(body.userId ?? '').trim();
    const secret = String(body.secret ?? '').trim();
    if (!userId || !secret) return json({ error: 'missing credentials' }, 400);

    const session = await getUserSession(userId);
    if (!session?.secretHash) return json({ error: 'not linked' }, 404);

    if (!sameSecret(session.secretHash, await hashSecret(secret))) {
      return json({ error: 'not authorised' }, 403);
    }

    try {
      const accessToken = await accessTokenForUser(userId);
      return json({ accessToken });
    } catch (e) {
      if (e instanceof DelegationFailed) {
        // The stored session is gone for good; the browser must sign in again.
        return json({ error: e.message, relink: true }, 401);
      }
      throw e;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unexpected error';
    return json({ error: message }, 500);
  }
}
