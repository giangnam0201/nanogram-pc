/* Room list, creation and join-by-code.
 *
 *   GET  /api/rooms            rooms this user is in
 *   POST /api/rooms            { title, styleId, dimension, creditQuota } -> create
 *   POST /api/rooms  { code }  join an existing room by invite code
 */

import { fail, identify, json } from './_lib/auth';
import { canDelegate } from './_lib/crypto';
import {
  addMember,
  backendKind,
  appendEvent,
  createRoom,
  getRoom,
  isOnline,
  listMembers,
  myRooms,
  roomIdForCode,
} from './_lib/rooms';

export const config = { runtime: 'edge' };

/** Room shape for list views — enough to render a card, nothing heavy. */
async function summarise(roomId: string) {
  const room = await getRoom(roomId);
  if (!room) return null;
  const members = await listMembers(roomId);
  const now = Date.now();
  return {
    id: room.id,
    code: room.code,
    title: room.title,
    hostId: room.hostId,
    hostName: room.hostName,
    htmlVersion: room.htmlVersion,
    publishedGameId: room.publishedGameId,
    delegated: room.delegated,
    memberCount: members.length,
    onlineCount: members.filter((m) => isOnline(m, now)).length,
    members: members.slice(0, 6).map((m) => ({
      id: m.id,
      username: m.username,
      avatarUrl: m.avatarUrl,
      online: isOnline(m, now),
    })),
    updatedAt: room.updatedAt,
  };
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const me = await identify(req);

    if (req.method === 'GET') {
      const rooms = await myRooms(me.id);
      const summaries = await Promise.all(rooms.map((r) => summarise(r.id)));
      return json({
        rooms: summaries.filter(Boolean),
        // The UI warns when rooms cannot outlive a single request.
        storage: backendKind(),
        delegationAvailable: canDelegate,
      });
    }

    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const body = (await req.json().catch(() => ({}))) as {
      code?: string;
      title?: string;
      styleId?: string | null;
      dimension?: string | null;
      creditQuota?: number;
    };

    /* ---- join by code ---- */
    if (body.code) {
      const roomId = await roomIdForCode(body.code);
      if (!roomId) return json({ error: 'That invite code does not match a room.' }, 404);
      const room = await getRoom(roomId);
      if (!room) return json({ error: 'That room has expired.' }, 404);

      const members = await listMembers(room.id);
      const alreadyIn = members.some((m) => m.id === me.id);
      await addMember(room, me);
      if (!alreadyIn) {
        await appendEvent(room.id, {
          type: 'join',
          actorId: me.id,
          actorName: me.username,
          actorAvatar: me.avatarUrl,
        });
      }
      return json({ room: await summarise(room.id) });
    }

    /* ---- create ---- */
    const room = await createRoom(me, {
      title: body.title,
      styleId: body.styleId,
      dimension: body.dimension,
      creditQuota: body.creditQuota,
    });
    await appendEvent(room.id, {
      type: 'join',
      actorId: me.id,
      actorName: me.username,
      actorAvatar: me.avatarUrl,
    });
    return json({ room: await summarise(room.id) }, 201);
  } catch (e) {
    return fail(e);
  }
}
