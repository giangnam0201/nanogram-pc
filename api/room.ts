/* A single room: read its state, and act on it.
 *
 *   GET  /api/room?id=…&since=…&html=1
 *   POST /api/room?id=…   { action, … }
 *
 * Actions are dispatched on `action` rather than split across many files
 * because they all share the same load-room-and-check-membership preamble.
 *
 * Who runs a build
 *   delegation armed  -> the server sends the prompt with the host's token, so
 *                        anyone can build and the host need not be present
 *   otherwise         -> only the host can build, from their own browser, and
 *                        uploads the result back with the `snapshot` action
 */

import { fail, identify, json, type Identity } from './_lib/auth';
import { canDelegate, DelegationUnavailable, encryptSecret } from './_lib/crypto';
import {
  appendEvent,
  backendKind,
  clearUserToken,
  getUserToken,
  saveUserToken,
  creditsSpent,
  currentSeq,
  getHtml,
  getMember,
  getRoom,
  isOnline,
  listMembers,
  noteCreditSpent,
  quotaAllows,
  readEvents,
  ROOM_TTL,
  saveRoom,
  setHtml,
  touchMember,
  type Room,
} from './_lib/rooms';
import { asHost, canBuildOnOwner, dropCachedAccess, roomBuildToken } from './_lib/nanogram';
// Same parser the screens use, so the room and the single-player flow can
// never disagree about what the model asked.
import { parseAssistant } from '../src/lib/gamegen';

export const config = { runtime: 'edge' };

const MAX_DELEGATION_HOURS = 48;

async function state(room: Room, since: number, includeHtml: boolean) {
  const [members, events, seq, spent, offline] = await Promise.all([
    listMembers(room.id),
    readEvents(room.id, since),
    currentSeq(room.id),
    creditsSpent(room.id),
    canBuildOnOwner(room),
  ]);
  const now = Date.now();
  const host = members.find((m) => m.isHost);

  return {
    room: {
      id: room.id,
      code: room.code,
      title: room.title,
      hostId: room.hostId,
      hostName: room.hostName,
      styleId: room.styleId,
      dimension: room.dimension,
      sessionId: room.sessionId,
      sessionOwnerId: room.sessionOwnerId,
      htmlVersion: room.htmlVersion,
      publishedGameId: room.publishedGameId,
      creditQuota: room.creditQuota,
      delegated: room.delegated,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    },
    members: members.map((m) => ({ ...m, online: isOnline(m, now) })),
    events,
    seq,
    creditsSpent: spent,
    hostOnline: host ? isOnline(host, now) : false,
    canBuildOnOwner: offline,
    storage: backendKind(),
    delegationAvailable: canDelegate,
    html: includeHtml ? await getHtml(room.id) : undefined,
  };
}

/** Load the room and confirm the caller belongs to it. */
async function require(req: Request, me: Identity): Promise<Room> {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) throw Object.assign(new Error('missing room id'), { status: 400 });
  const room = await getRoom(id);
  if (!room) throw Object.assign(new Error('That room has expired.'), { status: 404 });
  const member = await getMember(room.id, me.id);
  if (!member) throw Object.assign(new Error('You are not in this room.'), { status: 403 });
  return room;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const me = await identify(req);
    const url = new URL(req.url);

    let room: Room;
    try {
      room = await require(req, me);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return json({ error: (e as Error).message }, status);
    }

    if (req.method === 'GET') {
      await touchMember(room.id, me.id);
      const since = Number(url.searchParams.get('since') ?? 0);
      return json(await state(room, since, url.searchParams.get('html') === '1'));
    }

    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const isHost = me.id === room.hostId;

    switch (action) {
      /* ------------------------------------------------------ presence --- */
      case 'heartbeat': {
        await touchMember(room.id, me.id);
        const since = Number(body.since ?? 0);
        return json(await state(room, since, false));
      }

      /* ---------------------------------------------------------- chat --- */
      case 'chat': {
        const text = String(body.text ?? '').trim().slice(0, 1000);
        if (!text) return json({ error: 'empty message' }, 400);
        const event = await appendEvent(room.id, {
          type: 'chat',
          actorId: me.id,
          actorName: me.username,
          actorAvatar: me.avatarUrl,
          text,
        });
        await touchMember(room.id, me.id);
        return json({ event });
      }

      /* --------------------------------------------------------- build --- */
      case 'prompt': {
        const text = String(body.text ?? '').trim().slice(0, 1000);
        if (!text) return json({ error: 'empty prompt' }, 400);

        if (!(await quotaAllows(room))) {
          return json(
            {
              error: `This room has used its ${room.creditQuota}-credit limit. ${room.hostName} can raise it in room settings.`,
            },
            403,
          );
        }

        // Record the request first, so everyone sees it even if the build fails.
        await appendEvent(room.id, {
          type: 'prompt',
          actorId: me.id,
          actorName: me.username,
          actorAvatar: me.avatarUrl,
          text,
        });

        const onOwner = await canBuildOnOwner(room);
        if (!onOwner) {
          /* The room owner has no stored sign-in, so the server cannot drive
             their session. Fall back to the caller's own browser: sessions are
             single-owner, but createSession accepts remixHtml, so the game
             continues from the room's current build in a session of theirs. */
          const canContinue = Boolean(room.sessionId && room.sessionOwnerId === me.id);
          await appendEvent(room.id, {
            type: 'build-start',
            actorId: me.id,
            actorName: me.username,
            actorAvatar: me.avatarUrl,
            text,
          });
          return json({
            mode: 'local',
            continueSession: canContinue ? room.sessionId : null,
          });
        }

        const token = await roomBuildToken(room);

        let sessionId = room.sessionId;
        if (!sessionId || room.sessionOwnerId !== room.hostId) {
          // Seed from whatever the room has built so far, so a session started
          // by someone else is carried forward rather than lost.
          const created = await asHost.createSession(token, {
            styleId: room.styleId ?? '',
            dimension: room.dimension ?? undefined,
            description: text,
            remixHtml: (await getHtml(room.id)) ?? '',
          });
          sessionId = created.id;
          room.sessionId = sessionId;
          room.sessionOwnerId = room.hostId;
          await saveRoom(room);
        }

        await asHost.sendMessage(token, sessionId, text);
        await noteCreditSpent(room.id);
        await appendEvent(room.id, {
          type: 'build-start',
          actorId: me.id,
          actorName: me.username,
          actorAvatar: me.avatarUrl,
          text,
        });
        return json({ mode: 'server', sessionId })
      }

      /* Pull the latest build result from Nanogram using the host's token.
         Members poll this while a delegated build is running. */
      case 'sync': {
        if (!(await canBuildOnOwner(room)) || !room.sessionId) {
          return json({ synced: false });
        }
        const token = await roomBuildToken(room);
        const res = await asHost.messages(token, room.sessionId);
        const messages = res.messages ?? [];
        const last = messages[messages.length - 1];
        // Newest snapshot wins; remixHtml is only the seed, and an empty one
        // must not be mistaken for a real build.
        const html =
          [...messages].reverse().find((m) => m.htmlSnapshot)?.htmlSnapshot ||
          res.remixHtml ||
          null;

        const running = last?.status === 'pending' || last?.status === 'running';
        if (html) {
          const previous = await getHtml(room.id);
          if (previous !== html) {
            await setHtml(room.id, html);
            room.htmlVersion += 1;
            if (res.title) room.title = res.title;
            await saveRoom(room);
            await appendEvent(room.id, {
              type: 'snapshot',
              actorId: room.hostId,
              actorName: room.hostName,
              version: room.htmlVersion,
            });
          }
        }

        /* The model often answers with a question rather than a build — "what
           kind of game?", with options to choose from. That has to reach the
           whole room: only the person who sent the prompt would otherwise ever
           see it, and if nobody answers the build simply stalls until it times
           out. Posted once, keyed on the message id. */
        if (!running && last && last.role !== 'user') {
          const parsed = parseAssistant(last.content);
          if (parsed.text || parsed.options.length) {
            const already = await readEvents(room.id, 0);
            const seen = already.some((e) => e.type === 'ai' && e.gameId === last.id);
            if (!seen) {
              await appendEvent(room.id, {
                type: 'ai',
                actorId: room.hostId,
                actorName: room.hostName,
                text: parsed.text,
                options: parsed.options,
                // Reused as the de-dupe key: one 'ai' event per model message.
                gameId: last.id,
              });
            }
          }
        }

        return json({ synced: true, running, htmlVersion: room.htmlVersion })
      }

      /* The host's browser created the room's GameGen session. Recorded straight
         away rather than waiting for the first snapshot: if that build fails,
         an unrecorded session is orphaned and the next attempt pays to create
         another one. */
      case 'session': {
        const sessionId = String(body.sessionId ?? '');
        if (!sessionId) return json({ error: 'missing sessionId' }, 400);
        // Whoever created it owns it — only their token can drive or publish it.
        room.sessionId = sessionId;
        room.sessionOwnerId = me.id;
        await saveRoom(room);
        return json({ ok: true });
      }

      /* The host's browser finished a local build and hands the result back. */
      case 'snapshot': {
        // Any member may post a build: that is what building together means.
        const html = typeof body.html === 'string' ? body.html : '';
        if (!html) return json({ error: 'missing html' }, 400);

        await setHtml(room.id, html);
        room.htmlVersion += 1;
        if (typeof body.sessionId === 'string') {
          room.sessionId = body.sessionId;
          room.sessionOwnerId = me.id;
        }
        if (typeof body.title === 'string' && body.title.trim()) room.title = body.title.trim();
        await saveRoom(room);
        await noteCreditSpent(room.id);
        await appendEvent(room.id, {
          type: 'snapshot',
          actorId: me.id,
          actorName: me.username,
          actorAvatar: me.avatarUrl,
          version: room.htmlVersion,
        });
        return json({ htmlVersion: room.htmlVersion });
      }

      /* The caller's browser saw the model ask a question instead of building.
         Posting it here is what makes it answerable by anyone in the room
         rather than only by whoever happened to send the prompt. */
      case 'asked': {
        const text = String(body.text ?? '').trim().slice(0, 2000);
        const options = Array.isArray(body.options)
          ? body.options
              .filter((o): o is string => typeof o === 'string')
              .map((o) => o.trim())
              .filter(Boolean)
              .slice(0, 8)
          : [];
        if (!text && options.length === 0) return json({ error: 'nothing to post' }, 400);

        const messageId = typeof body.messageId === 'string' ? body.messageId : undefined;
        if (messageId) {
          // Every member polls, so the same question can be reported more than
          // once. One event per model message.
          const already = await readEvents(room.id, 0);
          if (already.some((e) => e.type === 'ai' && e.gameId === messageId)) {
            return json({ ok: true, duplicate: true });
          }
        }

        const event = await appendEvent(room.id, {
          type: 'ai',
          actorId: room.hostId,
          actorName: room.hostName,
          text,
          options,
          gameId: messageId,
        });
        return json({ event });
      }

      case 'build-failed': {
        await appendEvent(room.id, {
          type: 'build-failed',
          actorId: me.id,
          actorName: me.username,
          text: String(body.text ?? 'The build failed.').slice(0, 300),
        });
        return json({ ok: true });
      }

      case 'published': {
        const gameId = String(body.gameId ?? '');
        if (!gameId) return json({ error: 'missing gameId' }, 400);
        room.publishedGameId = gameId;
        await saveRoom(room);
        await appendEvent(room.id, {
          type: 'published',
          actorId: me.id,
          actorName: me.username,
          actorAvatar: me.avatarUrl,
          gameId,
        });
        return json({ ok: true });
      }

      /* ------------------------------------------------------ settings --- */
      case 'settings': {
        if (!isHost) return json({ error: 'only the host can change settings' }, 403);
        if (typeof body.title === 'string' && body.title.trim()) {
          room.title = body.title.trim().slice(0, 80);
        }
        if (typeof body.creditQuota === 'number') {
          room.creditQuota = Math.max(0, Math.floor(body.creditQuota));
        }
        await saveRoom(room);
        await appendEvent(room.id, {
          type: 'settings',
          actorId: me.id,
          actorName: me.username,
          text: room.creditQuota > 0 ? `Credit limit set to ${room.creditQuota}` : 'Credit limit removed',
        });
        return json({ ok: true });
      }

      /* ---------------------------------------------------- delegation --- */
      case 'delegate': {
        if (!isHost) return json({ error: 'only the host can do this' }, 403);
        if (!canDelegate) throw new DelegationUnavailable();

        const refreshToken = String(body.refreshToken ?? '');
        if (!refreshToken) return json({ error: 'missing refresh token' }, 400);

        // Stored per user, not per room: one person may own several rooms, and
        // re-linking once should fix all of them.
        await saveUserToken(me.id, await encryptSecret(refreshToken));
        await dropCachedAccess(me.id);

        room.delegated = true;
        await saveRoom(room);
        await appendEvent(room.id, {
          type: 'settings',
          actorId: me.id,
          actorName: me.username,
          text: `Builds now run on @${me.username}'s credits`,
        });
        return json({ ok: true });
      }

      case 'revoke': {
        if (!isHost) return json({ error: 'only the host can do this' }, 403);
        await clearUserToken(me.id);
        await dropCachedAccess(me.id);
        room.delegated = false;
        await saveRoom(room);
        await appendEvent(room.id, {
          type: 'settings',
          actorId: me.id,
          actorName: me.username,
          text: `${me.username} unlinked their sign-in`,
        });
        return json({ ok: true });
      }

      /* Lets the host's client confirm what is stored without exposing it. */
      case 'delegation-status': {
        if (!isHost) return json({ error: 'only the host can do this' }, 403);
        return json({
          armed: Boolean(await getUserToken(room.hostId)),
          expiresAt: null,
          maxHours: MAX_DELEGATION_HOURS,
          available: canDelegate,
          roomTtlHours: ROOM_TTL / 3600,
        });
      }

      default:
        return json({ error: `unknown action “${action}”` }, 400);
    }
  } catch (e) {
    return fail(e);
  }
}
