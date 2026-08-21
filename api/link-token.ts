/* Store the caller's Nanogram refresh token so their rooms can build.
 *
 *   POST   /api/link-token   { refreshToken }
 *   GET    /api/link-token                     -> whether one is stored
 *   DELETE /api/link-token                     -> forget it
 *
 * A room's builds run on the room owner's Nanogram session, so the room keeps
 * one AI conversation and one credit pool no matter who typed the prompt or
 * who is currently online. That requires the owner's session to be usable from
 * the server, which means storing their refresh token.
 *
 * The token is AES-256-GCM encrypted before it is written and the key lives
 * only in the environment, so the stored row is useless on its own. Without
 * ROOM_DELEGATION_KEY configured this refuses outright rather than writing a
 * credential in the clear.
 *
 * The token is never returned, not even to the person it belongs to.
 */

import { fail, identify, json } from './_lib/auth';
import { canDelegate, encryptSecret, hashSecret, newSecret } from './_lib/crypto';
import { clearUserToken, getUserToken, saveUserToken } from './_lib/rooms';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  try {
    const me = await identify(req);

    if (req.method === 'GET') {
      return json({
        linked: Boolean(await getUserToken(me.id)),
        available: canDelegate,
      });
    }

    if (req.method === 'DELETE') {
      await clearUserToken(me.id);
      return json({ linked: false });
    }

    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    if (!canDelegate) {
      return json(
        {
          error:
            'This deployment has no ROOM_DELEGATION_KEY, so sign-ins cannot be stored safely.',
        },
        503,
      );
    }

    const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
    const refreshToken = String(body.refreshToken ?? '').trim();
    if (!refreshToken) return json({ error: 'missing refresh token' }, 400);

    /* Issue a secret the browser keeps. From here on the server is the only
       party that refreshes this session — Nanogram rotates refresh tokens, so
       if the browser kept refreshing too, whichever went second would find its
       token already retired and sign the person out. The browser presents this
       secret to /api/session-token instead. */
    const secret = newSecret();
    await saveUserToken(me.id, await encryptSecret(refreshToken), await hashSecret(secret));
    return json({ linked: true, secret, userId: me.id });
  } catch (e) {
    return fail(e);
  }
}
