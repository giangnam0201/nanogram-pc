/* Live room stream (Server-Sent Events).
 *
 *   GET /api/room-events?id=…&since=…
 *
 * Vercel functions cannot hold a WebSocket, so this is SSE: a response that
 * stays open and appends events as they land. Serverless still caps how long a
 * single invocation may run, so each stream deliberately ends after
 * STREAM_MS and the client immediately reconnects with its cursor. No event is
 * lost across that seam because `since` is a monotonic sequence number, not a
 * timestamp.
 *
 * Deliberately NOT consumed with `EventSource`: that API cannot send an
 * Authorization header, which would force the access token into the query
 * string, and from there into server logs and browser history. The client
 * reads this with streaming `fetch` instead.
 *
 * Cost note: a tick costs one Redis read (`GET seq`) and only fans out to a
 * full fetch when the cursor actually moved. The tick rate follows how recently
 * anything happened, and presence — the expensive part, since it reads and
 * writes the member hash — runs on its own slow beat. An idle viewer therefore
 * costs roughly 15 commands a minute rather than 60+.
 */

import { fail, identify, json } from './_lib/auth';
import { cmd } from './_lib/store';
import {
  currentSeq,
  getMember,
  getRoom,
  isOnline,
  readEvents,
  refreshPresence,
} from './_lib/rooms';

export const config = { runtime: 'edge' };

/** Comfortably inside the platform's per-invocation ceiling. */
const STREAM_MS = 20_000;

/* Polling cadence, chosen by how recently anything actually happened.
 *
 * A fixed one-second tick charges a busy room and a room where three people are
 * reading in silence exactly the same amount, and most of a room's life is the
 * second kind. Backing off turns an idle viewer from ~3,600 commands an hour
 * into a few hundred, which is the difference between the free tier lasting
 * days and lasting months. A room that is actually in use snaps back to one
 * second on the next event. */
const TICK_ACTIVE_MS = 1_000;
const TICK_QUIET_MS = 4_000;
const TICK_IDLE_MS = 12_000;
const QUIET_AFTER_MS = 30_000;
const IDLE_AFTER_MS = 180_000;

function tickFor(sinceLastEventMs: number): number {
  if (sinceLastEventMs > IDLE_AFTER_MS) return TICK_IDLE_MS;
  if (sinceLastEventMs > QUIET_AFTER_MS) return TICK_QUIET_MS;
  return TICK_ACTIVE_MS;
}

/** Presence changes silently, and the staleness window is 45s, so a slow beat
 *  is plenty — and it is the expensive call. */
const PRESENCE_EVERY_MS = 15_000;

function frame(event: string, data: unknown, id?: number): string {
  const lines = [`event: ${event}`, `data: ${JSON.stringify(data)}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  return lines.join('\n') + '\n\n';
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const me = await identify(req);
    const url = new URL(req.url);
    const roomId = url.searchParams.get('id') ?? '';
    if (!roomId) return json({ error: 'missing room id' }, 400);

    const room = await getRoom(roomId);
    if (!room) return json({ error: 'That room has expired.' }, 404);
    if (!(await getMember(roomId, me.id))) {
      return json({ error: 'You are not in this room.' }, 403);
    }

    let cursor = Number(url.searchParams.get('since') ?? 0);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
            return true;
          } catch {
            return false; // client went away mid-write
          }
        };

        const started = Date.now();
        // Tell the client where it stands before any incremental events.
        send(frame('hello', { seq: await currentSeq(roomId), you: me.id }));

        let lastEventAt = Date.now();
        let lastPresenceAt = 0;
        let lastKeepaliveAt = Date.now();

        try {
          while (Date.now() - started < STREAM_MS) {
            await new Promise((r) => setTimeout(r, tickFor(Date.now() - lastEventAt)));

            // One cheap read decides whether anything happened at all.
            const seq = Number(((await cmd('GET', `room:${roomId}:seq`)) as string) ?? 0);
            if (seq > cursor) {
              const events = await readEvents(roomId, cursor);
              for (const event of events) {
                if (!send(frame('event', event, event.seq))) return;
              }
              cursor = seq;
              // Something happened, so drop back to the fast cadence.
              lastEventAt = Date.now();
            }

            const now = Date.now();
            if (now - lastPresenceAt >= PRESENCE_EVERY_MS) {
              lastPresenceAt = now;
              const members = (await refreshPresence(roomId, me.id)).map((m) => ({
                id: m.id,
                username: m.username,
                avatarUrl: m.avatarUrl,
                isHost: m.isHost,
                online: isOnline(m, now),
              }));
              if (!send(frame('presence', { members }))) return;
              lastKeepaliveAt = now;
            } else if (now - lastKeepaliveAt >= 10_000) {
              lastKeepaliveAt = now;
              // Comment frame: keeps intermediaries from buffering the stream.
              if (!send(': keepalive\n\n')) return;
            }
          }
          // Hand the cursor back so the reconnect resumes exactly here.
          send(frame('bye', { seq: cursor }));
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed by the client disconnecting */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Disables proxy buffering, which would otherwise defeat streaming.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
