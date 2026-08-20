/* Room domain logic — the shared state behind Multi-Creator.
 *
 * Two backends sit behind one API:
 *
 *   Supabase   the real one. Rooms, members, events, snapshots and delegation
 *              are tables (see supabase/schema.sql). Clients subscribe to
 *              room_events through Realtime, so nothing here polls.
 *
 *   memory     local development with no configuration. One process, one Map.
 *              Useless on Vercel, where every invocation is isolated, and the
 *              UI says so when it is live.
 *
 * Presence differs between them and deliberately so. Supabase Realtime tracks
 * presence itself, ephemerally and for free, so nothing is written to the
 * database for it. The memory backend has no such channel, so it falls back to
 * a stored `lastSeen` that the SSE endpoint refreshes.
 *
 * Build snapshots are whole HTML documents, far too large to push through a
 * realtime stream. The event log carries only a version marker; clients fetch
 * the body separately when it changes.
 */

import { cmd, getJson, hgetAll, setJson } from './store';
import { hasSupabase, sb, sbOne } from './db';
import type { Identity } from './auth';

/** Rooms are ephemeral by design; idle ones evaporate rather than accumulate. */
export const ROOM_TTL = 60 * 60 * 48;
const EVENT_CAP = 400;
const PRESENCE_STALE_MS = 45_000;

export function backendKind(): 'supabase' | 'memory' {
  return hasSupabase ? 'supabase' : 'memory';
}

export type EventType =
  | 'chat'
  | 'join'
  | 'leave'
  | 'prompt'
  | 'build-start'
  | 'build-done'
  | 'build-failed'
  | 'snapshot'
  | 'published'
  | 'title'
  | 'settings';

export interface RoomEvent {
  seq: number;
  type: EventType;
  at: string;
  actorId: string;
  actorName: string;
  actorAvatar?: string | null;
  text?: string;
  version?: number;
  gameId?: string;
}

export interface Member {
  id: string;
  username: string;
  avatarUrl: string | null;
  joinedAt: string;
  lastSeen: string;
  isHost: boolean;
}

export interface Room {
  id: string;
  code: string;
  title: string;
  hostId: string;
  hostName: string;
  styleId: string | null;
  dimension: string | null;
  /** The GameGen session holding the current build. Sessions are single-owner,
   *  so only `sessionOwnerId` can drive or publish it; anyone else building
   *  starts their own, seeded from the room's HTML. */
  sessionId: string | null;
  sessionOwnerId: string | null;
  htmlVersion: number;
  publishedGameId: string | null;
  /** Ceiling on credits this room may spend, set by the host. 0 = unlimited. */
  creditQuota: number;
  creditsSpent: number;
  /** Whether the host armed offline delegation. The secret lives elsewhere. */
  delegated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Delegation {
  hostId: string;
  /** AES-GCM blob — see crypto.ts. Never leaves the server. */
  refreshToken: string;
  armedAt: string;
  expiresAt: string;
}

/* ------------------------------------------------------------- mapping --- */

interface RoomRow {
  id: string;
  code: string;
  title: string;
  host_id: string;
  host_name: string;
  style_id: string | null;
  dimension: string | null;
  session_id: string | null;
  session_owner_id: string | null;
  html_version: number;
  published_game_id: string | null;
  credit_quota: number;
  credits_spent: number;
  delegated: boolean;
  created_at: string;
  updated_at: string;
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    hostId: row.host_id,
    hostName: row.host_name,
    styleId: row.style_id,
    dimension: row.dimension,
    sessionId: row.session_id,
    sessionOwnerId: row.session_owner_id,
    htmlVersion: row.html_version,
    publishedGameId: row.published_game_id,
    creditQuota: row.credit_quota,
    creditsSpent: row.credits_spent,
    delegated: row.delegated,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function toEvent(row: EventRow): RoomEvent {
  return {
    seq: Number(row.id),
    type: row.type as EventType,
    at: row.at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorAvatar: row.actor_avatar,
    text: row.body ?? undefined,
    version: row.version ?? undefined,
    gameId: row.game_id ?? undefined,
  };
}

interface MemberRow {
  user_id: string;
  username: string;
  avatar_url: string | null;
  is_host: boolean;
  joined_at: string;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url,
    joinedAt: row.joined_at,
    // Supabase presence is live, not stored; callers use the realtime channel.
    lastSeen: row.joined_at,
    isHost: row.is_host,
  };
}

/* ---------------------------------------------------------------- ids --- */

/** Invite codes get read aloud and retyped, so drop look-alike characters. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/* -------------------------------------------------------------- rooms --- */

export async function createRoom(
  host: Identity,
  input: { title?: string; styleId?: string | null; dimension?: string | null; creditQuota?: number },
): Promise<Room> {
  const title = (input.title ?? '').trim().slice(0, 80) || 'Untitled room';
  const quota = Math.max(0, Math.floor(input.creditQuota ?? 0));

  if (hasSupabase) {
    // The code column is unique, so a collision surfaces as a 409 to retry.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const rows = await sb<RoomRow[]>('rooms', {
          method: 'POST',
          prefer: 'return=representation',
          body: {
            code: randomCode(),
            title,
            host_id: host.id,
            host_name: host.username,
            style_id: input.styleId ?? null,
            dimension: input.dimension ?? null,
            credit_quota: quota,
          },
        });
        const room = toRoom(rows[0]);
        await addMember(room, host);
        return room;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 409) throw e;
      }
    }
    throw new Error('could not allocate an invite code');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let code = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = randomCode();
    if (await cmd('SET', `roomcode:${candidate}`, id, 'EX', ROOM_TTL, 'NX')) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error('could not allocate an invite code');

  const room: Room = {
    id,
    code,
    title,
    hostId: host.id,
    hostName: host.username,
    styleId: input.styleId ?? null,
    dimension: input.dimension ?? null,
    sessionId: null,
    sessionOwnerId: null,
    htmlVersion: 0,
    publishedGameId: null,
    creditQuota: quota,
    creditsSpent: 0,
    delegated: false,
    createdAt: now,
    updatedAt: now,
  };
  await setJson(`room:${id}`, room, ROOM_TTL);
  await addMember(room, host);
  return room;
}

export async function getRoom(id: string): Promise<Room | null> {
  if (!hasSupabase) return getJson<Room>(`room:${id}`);
  // A UUID column rejects a malformed id with a 400 rather than "not found".
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await sbOne<RoomRow>('rooms', { query: `id=eq.${id}&select=*` });
  return row ? toRoom(row) : null;
}

export async function saveRoom(room: Room): Promise<void> {
  room.updatedAt = new Date().toISOString();
  if (!hasSupabase) {
    await setJson(`room:${room.id}`, room, ROOM_TTL);
    return;
  }
  await sb('rooms', {
    method: 'PATCH',
    query: `id=eq.${room.id}`,
    body: {
      title: room.title,
      style_id: room.styleId,
      dimension: room.dimension,
      session_id: room.sessionId,
      session_owner_id: room.sessionOwnerId,
      html_version: room.htmlVersion,
      published_game_id: room.publishedGameId,
      credit_quota: room.creditQuota,
      delegated: room.delegated,
      updated_at: room.updatedAt,
    },
  });
}

export async function roomIdForCode(code: string): Promise<string | null> {
  const value = code.trim().toUpperCase();
  if (!hasSupabase) return ((await cmd('GET', `roomcode:${value}`)) as string | null) ?? null;
  const row = await sbOne<{ id: string }>('rooms', {
    query: `code=eq.${encodeURIComponent(value)}&select=id`,
  });
  return row?.id ?? null;
}

/** Rooms this user has joined, most recently active first. */
export async function myRooms(userId: string): Promise<Room[]> {
  if (hasSupabase) {
    const rows = await sb<{ rooms: RoomRow | null }[]>('room_members', {
      query: `user_id=eq.${encodeURIComponent(userId)}&select=rooms(*)`,
    });
    return rows
      .map((r) => r.rooms)
      .filter((r): r is RoomRow => Boolean(r))
      .map(toRoom)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const ids = (await cmd('LRANGE', `user:${userId}:rooms`, 0, -1)) as unknown;
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const rooms: Room[] = [];
  for (const raw of [...ids].reverse()) {
    const id = String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    const room = await getRoom(id);
    if (room) rooms.push(room);
  }
  return rooms;
}

/* ------------------------------------------------------------ members --- */

export async function addMember(room: Room, who: Identity): Promise<Member> {
  const existing = await getMember(room.id, who.id);
  const now = new Date().toISOString();
  const member: Member = {
    id: who.id,
    username: who.username,
    avatarUrl: who.avatarUrl,
    joinedAt: existing?.joinedAt ?? now,
    lastSeen: now,
    isHost: who.id === room.hostId,
  };

  if (hasSupabase) {
    await sb('room_members', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        room_id: room.id,
        user_id: member.id,
        username: member.username,
        avatar_url: member.avatarUrl,
        is_host: member.isHost,
      },
    });
    return member;
  }

  await cmd('HSET', `room:${room.id}:members`, who.id, JSON.stringify(member));
  await cmd('EXPIRE', `room:${room.id}:members`, ROOM_TTL);
  if (!existing) {
    await cmd('RPUSH', `user:${who.id}:rooms`, room.id);
    await cmd('EXPIRE', `user:${who.id}:rooms`, ROOM_TTL);
  }
  return member;
}

export async function getMember(roomId: string, userId: string): Promise<Member | null> {
  if (hasSupabase) {
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;
    const row = await sbOne<MemberRow>('room_members', {
      query: `room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
    });
    return row ? toMember(row) : null;
  }
  const raw = (await hgetAll(`room:${roomId}:members`))[userId];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

export async function listMembers(roomId: string): Promise<Member[]> {
  let out: Member[];
  if (hasSupabase) {
    const rows = await sb<MemberRow[]>('room_members', {
      query: `room_id=eq.${roomId}&select=*`,
    });
    out = rows.map(toMember);
  } else {
    out = [];
    for (const raw of Object.values(await hgetAll(`room:${roomId}:members`))) {
      try {
        out.push(JSON.parse(raw) as Member);
      } catch {
        /* one corrupt row shouldn't hide the rest of the room */
      }
    }
  }
  return out.sort((a, b) =>
    a.isHost ? -1 : b.isHost ? 1 : a.joinedAt.localeCompare(b.joinedAt),
  );
}

/* Presence for the memory backend only. With Supabase the client's realtime
   channel is the source of truth and none of this is consulted. */

export function isOnline(member: Member, now = Date.now()): boolean {
  return now - Date.parse(member.lastSeen) < PRESENCE_STALE_MS;
}

export async function touchMember(roomId: string, userId: string): Promise<void> {
  if (hasSupabase) return;
  const member = await getMember(roomId, userId);
  if (!member) return;
  member.lastSeen = new Date().toISOString();
  await cmd('HSET', `room:${roomId}:members`, userId, JSON.stringify(member));
}

/** Mark this viewer present and return the member list in one read. */
export async function refreshPresence(roomId: string, userId: string): Promise<Member[]> {
  if (hasSupabase) return listMembers(roomId);

  const all = await hgetAll(`room:${roomId}:members`);
  const members: Member[] = [];
  let mine: Member | null = null;

  for (const [id, raw] of Object.entries(all)) {
    try {
      const member = JSON.parse(raw) as Member;
      if (id === userId) {
        member.lastSeen = new Date().toISOString();
        mine = member;
      }
      members.push(member);
    } catch {
      /* skip a corrupt row */
    }
  }

  if (mine) {
    await cmd('HSET', `room:${roomId}:members`, userId, JSON.stringify(mine));
  }

  return members.sort((a, b) =>
    a.isHost ? -1 : b.isHost ? 1 : a.joinedAt.localeCompare(b.joinedAt),
  );
}

/* ------------------------------------------------------------- events --- */

export async function appendEvent(
  roomId: string,
  event: Omit<RoomEvent, 'seq' | 'at'> & { at?: string },
): Promise<RoomEvent> {
  if (hasSupabase) {
    // The insert is what Realtime broadcasts; nothing else has to fan out.
    const rows = await sb<EventRow[]>('room_events', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        room_id: roomId,
        type: event.type,
        actor_id: event.actorId,
        actor_name: event.actorName,
        actor_avatar: event.actorAvatar ?? null,
        body: event.text ?? null,
        version: event.version ?? null,
        game_id: event.gameId ?? null,
      },
    });
    return toEvent(rows[0]);
  }

  const seq = Number(await cmd('INCR', `room:${roomId}:seq`));
  await cmd('EXPIRE', `room:${roomId}:seq`, ROOM_TTL);
  const full: RoomEvent = { ...event, seq, at: event.at ?? new Date().toISOString() };
  await cmd('RPUSH', `room:${roomId}:events`, JSON.stringify(full));
  await cmd('LTRIM', `room:${roomId}:events`, -EVENT_CAP, -1);
  await cmd('EXPIRE', `room:${roomId}:events`, ROOM_TTL);
  return full;
}

/** Events newer than `sinceSeq`. Serves history and reconnect catch-up alike. */
export async function readEvents(roomId: string, sinceSeq = 0): Promise<RoomEvent[]> {
  if (hasSupabase) {
    const rows = await sb<EventRow[]>('room_events', {
      query: `room_id=eq.${roomId}&id=gt.${sinceSeq}&select=*&order=id.asc&limit=${EVENT_CAP}`,
    });
    return rows.map(toEvent);
  }

  const raw = (await cmd('LRANGE', `room:${roomId}:events`, 0, -1)) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: RoomEvent[] = [];
  for (const item of raw) {
    try {
      const e = JSON.parse(String(item)) as RoomEvent;
      if (e.seq > sinceSeq) out.push(e);
    } catch {
      /* skip unparseable rows */
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export async function currentSeq(roomId: string): Promise<number> {
  if (hasSupabase) {
    const row = await sbOne<{ id: number }>('room_events', {
      query: `room_id=eq.${roomId}&select=id&order=id.desc&limit=1`,
    });
    return Number(row?.id ?? 0);
  }
  return Number(((await cmd('GET', `room:${roomId}:seq`)) as string) ?? 0);
}

/* ------------------------------------------------------------ snapshot --- */

export async function setHtml(roomId: string, html: string): Promise<void> {
  if (hasSupabase) {
    await sb('room_html', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { room_id: roomId, html, updated_at: new Date().toISOString() },
    });
    return;
  }
  await cmd('SET', `room:${roomId}:html`, html, 'EX', ROOM_TTL);
}

export async function getHtml(roomId: string): Promise<string | null> {
  if (hasSupabase) {
    const row = await sbOne<{ html: string }>('room_html', {
      query: `room_id=eq.${roomId}&select=html`,
    });
    return row?.html ?? null;
  }
  return (await cmd('GET', `room:${roomId}:html`)) as string | null;
}

/* -------------------------------------------------------------- quota --- */

export async function creditsSpent(roomId: string): Promise<number> {
  if (hasSupabase) {
    const row = await sbOne<{ credits_spent: number }>('rooms', {
      query: `id=eq.${roomId}&select=credits_spent`,
    });
    return Number(row?.credits_spent ?? 0);
  }
  return Number(((await cmd('GET', `room:${roomId}:spent`)) as string) ?? 0);
}

export async function noteCreditSpent(roomId: string): Promise<number> {
  if (hasSupabase) {
    // Atomic: two simultaneous builds must not both slip past the quota.
    const { rpc } = await import('./db');
    return Number(await rpc<number>('spend_room_credit', { room: roomId }));
  }
  const next = Number(await cmd('INCR', `room:${roomId}:spent`));
  await cmd('EXPIRE', `room:${roomId}:spent`, ROOM_TTL);
  return next;
}

/** Whether another build is allowed under the host's ceiling. */
export async function quotaAllows(room: Room): Promise<boolean> {
  if (room.creditQuota <= 0) return true;
  return (await creditsSpent(room.id)) < room.creditQuota;
}

/* --------------------------------------------------------- delegation --- */

interface DelegationRow {
  host_id: string;
  refresh_token_enc: string;
  armed_at: string;
  expires_at: string;
}

export async function getDelegation(roomId: string): Promise<Delegation | null> {
  if (hasSupabase) {
    const row = await sbOne<DelegationRow>('room_delegation', {
      query: `room_id=eq.${roomId}&select=*`,
    });
    return row
      ? {
          hostId: row.host_id,
          refreshToken: row.refresh_token_enc,
          armedAt: row.armed_at,
          expiresAt: row.expires_at,
        }
      : null;
  }
  return getJson<Delegation>(`room:${roomId}:deleg`);
}

export async function setDelegation(roomId: string, delegation: Delegation): Promise<void> {
  if (hasSupabase) {
    await sb('room_delegation', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        room_id: roomId,
        host_id: delegation.hostId,
        refresh_token_enc: delegation.refreshToken,
        armed_at: delegation.armedAt,
        expires_at: delegation.expiresAt,
      },
    });
    return;
  }
  const ttl = Math.max(60, Math.floor((Date.parse(delegation.expiresAt) - Date.now()) / 1000));
  await setJson(`room:${roomId}:deleg`, delegation, Math.min(ttl, ROOM_TTL));
}

export async function clearDelegation(roomId: string): Promise<void> {
  if (hasSupabase) {
    await sb('room_delegation', { method: 'DELETE', query: `room_id=eq.${roomId}` });
    return;
  }
  await cmd('DEL', `room:${roomId}:deleg`);
}
