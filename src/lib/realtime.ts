/* Supabase Realtime transport for a room.
 *
 * Replaces the SSE polling loop with a pushed subscription:
 *
 *   events    postgres_changes on room_events — the insert IS the broadcast,
 *             so the server never fans anything out and an idle room costs
 *             nothing at all
 *   presence  Realtime Presence, which is ephemeral and never touches the
 *             database, so who is online is no longer something we store,
 *             expire, or poll for
 *
 * Only `@supabase/realtime-js` is used, not the full SDK: every read and write
 * still goes through our own API, which holds the service role key and verifies
 * the caller's Nanogram token. The browser's only Supabase credential is the
 * short-lived JWT from /api/room-token, which RLS scopes to rooms it belongs to.
 *
 * Two gaps the subscription cannot close on its own, both handled by the caller
 * fetching from `since`: events inserted while the socket was down, and history
 * from before the client joined.
 */

import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import type { RoomEvent, RoomMember } from './rooms';

export interface RealtimeCreds {
  available: boolean;
  url?: string;
  token?: string;
  expiresAt?: number;
  topic?: string;
}

interface EventRow {
  id: number;
  type: string;
  actor_id: string;
  actor_name: string;
  actor_avatar: string | null;
  body: string | null;
  version: number | null;
  game_id: string | null;
  at: string;
}

/** Postgres row shape -> the shape the screens already speak. */
function toEvent(row: EventRow): RoomEvent {
  return {
    seq: Number(row.id),
    type: row.type as RoomEvent['type'],
    at: row.at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorAvatar: row.actor_avatar,
    text: row.body ?? undefined,
    version: row.version ?? undefined,
    gameId: row.game_id ?? undefined,
  };
}

/** What we advertise about ourselves on the presence channel. */
export interface PresenceMeta {
  id: string;
  username: string;
  avatarUrl: string | null;
  isHost: boolean;
}

export interface RealtimeHandlers {
  onEvent(event: RoomEvent): void;
  onPresence(members: RoomMember[]): void;
  onStatus(status: 'live' | 'reconnecting' | 'offline'): void;
  /** Fetch anything missed while disconnected, from the given cursor. */
  onResync(): void;
}

/**
 * Subscribe to a room. Returns a function that unsubscribes.
 *
 * `me` is published to the presence channel so other members can see this
 * person online without any of it being written down.
 */
export function subscribeRoom(
  creds: Required<Pick<RealtimeCreds, 'url' | 'token'>>,
  roomId: string,
  me: PresenceMeta,
  handlers: RealtimeHandlers,
): () => void {
  let stopped = false;

  const client = new RealtimeClient(`${creds.url}/realtime/v1`, {
    params: { apikey: creds.token, eventsPerSecond: 20 },
  });
  client.setAuth(creds.token);

  const channel: RealtimeChannel = client.channel(`room:${roomId}`, {
    config: {
      // Our own membership is echoed back, which keeps the member list correct
      // without a separate round trip after joining.
      presence: { key: me.id },
      broadcast: { self: true },
    },
  });

  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (payload: { new: EventRow }) => {
      if (!stopped) handlers.onEvent(toEvent(payload.new));
    },
  );

  const syncPresence = () => {
    if (stopped) return;
    const state = channel.presenceState<PresenceMeta>();
    const members: RoomMember[] = [];
    for (const entries of Object.values(state)) {
      const first = entries[0];
      if (!first) continue;
      members.push({
        id: first.id,
        username: first.username,
        avatarUrl: first.avatarUrl,
        isHost: first.isHost,
        online: true,
      });
    }
    handlers.onPresence(members);
  };

  channel.on('presence', { event: 'sync' }, syncPresence);
  channel.on('presence', { event: 'join' }, syncPresence);
  channel.on('presence', { event: 'leave' }, syncPresence);

  channel.subscribe((status: string) => {
    if (stopped) return;
    if (status === 'SUBSCRIBED') {
      handlers.onStatus('live');
      // A subscription only delivers what happens next, so catch up on whatever
      // landed before this point — including anything missed across a reconnect.
      handlers.onResync();
      void channel.track(me);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      handlers.onStatus('reconnecting');
    } else if (status === 'CLOSED') {
      handlers.onStatus('offline');
    }
  });

  return () => {
    stopped = true;
    void channel.untrack().catch(() => {});
    void client.removeChannel(channel);
    client.disconnect();
    handlers.onStatus('offline');
  };
}
