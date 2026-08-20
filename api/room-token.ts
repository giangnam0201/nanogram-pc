/* Credentials for subscribing to a room over Supabase Realtime.
 *
 *   GET /api/room-token?id=…
 *
 * The browser never holds the service role key, and it has no Supabase account
 * of its own — its identity is a Nanogram one. So it asks here: we verify the
 * Nanogram token, confirm membership, and hand back a short-lived JWT carrying
 * the verified user id in an `ng_user` claim. The RLS policies in
 * supabase/schema.sql read that claim to decide which rooms may be subscribed
 * to, so a token for one user cannot be used to watch someone else's room.
 *
 * When Realtime is not configured this answers `available: false` and the
 * client falls back to the SSE endpoint.
 */

import { fail, identify, json } from './_lib/auth';
import { hasRealtime, mintRealtimeToken, supabaseUrl } from './_lib/db';
import { getMember, getRoom } from './_lib/rooms';

export const config = { runtime: 'edge' };

/** Comfortably longer than a sitting, short enough that access does not linger. */
const TOKEN_TTL_SECONDS = 3600;

export default async function handler(req: Request): Promise<Response> {
  try {
    const me = await identify(req);
    const roomId = new URL(req.url).searchParams.get('id') ?? '';
    if (!roomId) return json({ error: 'missing room id' }, 400);

    const room = await getRoom(roomId);
    if (!room) return json({ error: 'That room has expired.' }, 404);
    if (!(await getMember(roomId, me.id))) {
      return json({ error: 'You are not in this room.' }, 403);
    }

    if (!hasRealtime) {
      // Not an error: the client has a working fallback for exactly this.
      return json({ available: false });
    }

    const { token, expiresAt } = await mintRealtimeToken(me.id, TOKEN_TTL_SECONDS);
    return json({
      available: true,
      url: supabaseUrl(),
      token,
      expiresAt,
      // The channel a client should join for this room.
      topic: `room:${roomId}`,
    });
  } catch (e) {
    return fail(e);
  }
}
