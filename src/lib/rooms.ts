/* Client for the Multi-Creator room API (our own endpoints, not Nanogram's).
 *
 * Nanogram has no group chat and no realtime transport of any kind — its chat
 * API is strictly one-to-one — so shared rooms run on endpoints of our own.
 * Nanogram's real API still does everything it can: identity, credits, the
 * GameGen build itself, and DM-ing a friend the invite link.
 */

import { ipc } from './ipc';
import { isTauri } from './transport';
// Types only — erased at build time. The realtime client itself is imported
// dynamically in streamRoom so its ~16KB never loads for someone who does not
// open a room.
import type { PresenceMeta, RealtimeCreds } from './realtime';

/* The browser build is served alongside its own /api routes. The desktop build
   is not served by anything, so it needs to be pointed at a deployment. */
const BASE: string = (import.meta.env.VITE_ROOMS_API ?? (isTauri ? '' : '/api')).replace(/\/$/, '');

export const roomsAvailable = BASE !== '';

export interface RoomMember {
  id: string;
  username: string;
  avatarUrl: string | null;
  isHost: boolean;
  online: boolean;
  joinedAt?: string;
  lastSeen?: string;
}

export type RoomEventType =
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
  | 'settings'
  | 'ai';

export interface RoomEvent {
  seq: number;
  type: RoomEventType;
  at: string;
  actorId: string;
  actorName: string;
  actorAvatar?: string | null;
  text?: string;
  version?: number;
  gameId?: string;
  /** Suggested replies on an `ai` event. Anyone in the room may pick one. */
  options?: string[];
}

export interface RoomSummary {
  id: string;
  code: string;
  title: string;
  hostId: string;
  hostName: string;
  htmlVersion: number;
  publishedGameId: string | null;
  delegated: boolean;
  memberCount: number;
  onlineCount: number;
  members: { id: string; username: string; avatarUrl: string | null; online: boolean }[];
  updatedAt: string;
}

export interface RoomDetail {
  id: string;
  code: string;
  title: string;
  hostId: string;
  hostName: string;
  styleId: string | null;
  dimension: string | null;
  sessionId: string | null;
  sessionOwnerId: string | null;
  htmlVersion: number;
  publishedGameId: string | null;
  creditQuota: number;
  delegated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomState {
  room: RoomDetail;
  members: RoomMember[];
  events: RoomEvent[];
  seq: number;
  creditsSpent: number;
  hostOnline: boolean;
  canBuildOnOwner: boolean;
  storage: 'redis' | 'memory';
  delegationAvailable: boolean;
  html?: string | null;
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await ipc.gameToken();
  if (!token) throw new RoomError('You need to be signed in.', 401);
  return { Authorization: `Bearer ${token}` };
}

/* `body` is widened to unknown and JSON-encoded below, so RequestInit's own
   BodyInit typing has to be dropped rather than intersected. */
type JsonInit = Omit<RequestInit, 'body'> & { body?: unknown };

async function call<T>(path: string, init?: JsonInit): Promise<T> {
  if (!roomsAvailable) {
    throw new RoomError('Multi-Creator runs on the web app.', 501);
  }
  const headers: Record<string, string> = {
    ...(await authHeaders()),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new RoomError(message, res.status);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/* ------------------------------------------------------------ requests --- */

export const rooms = {
  list: () =>
    call<{ rooms: RoomSummary[]; storage: 'redis' | 'memory'; delegationAvailable: boolean }>(
      '/rooms',
    ),

  create: (body: { title?: string; styleId?: string | null; dimension?: string | null; creditQuota?: number }) =>
    call<{ room: RoomSummary }>('/rooms', { method: 'POST', body }),

  join: (code: string) => call<{ room: RoomSummary }>('/rooms', { method: 'POST', body: { code } }),

  get: (id: string, opts?: { since?: number; html?: boolean }) => {
    const q = new URLSearchParams({ id });
    if (opts?.since) q.set('since', String(opts.since));
    if (opts?.html) q.set('html', '1');
    return call<RoomState>(`/room?${q}`);
  },

  act: <T = unknown>(id: string, body: Record<string, unknown>) =>
    call<T>(`/room?id=${encodeURIComponent(id)}`, { method: 'POST', body }),

  chat: (id: string, text: string) => rooms.act<{ event: RoomEvent }>(id, { action: 'chat', text }),

  prompt: (id: string, text: string) =>
    rooms.act<{
      mode: 'local' | 'server';
      sessionId?: string;
      /** Set only when this caller already owns the session holding the latest
       *  build; otherwise start a fresh one seeded with the room's HTML. */
      continueSession?: string | null;
    }>(id, { action: 'prompt', text }),

  sync: (id: string) =>
    rooms.act<{ synced: boolean; running?: boolean; htmlVersion?: number }>(id, { action: 'sync' }),

  /** Record the room's GameGen session as soon as it exists, not at first build. */
  setSession: (id: string, sessionId: string) => rooms.act(id, { action: 'session', sessionId }),

  snapshot: (id: string, body: { html: string; sessionId?: string; title?: string }) =>
    rooms.act<{ htmlVersion: number }>(id, { action: 'snapshot', ...body }),

  heartbeat: (id: string, since: number) => rooms.act<RoomState>(id, { action: 'heartbeat', since }),

  settings: (id: string, body: { title?: string; creditQuota?: number }) =>
    rooms.act(id, { action: 'settings', ...body }),

  publishedGame: (id: string, gameId: string) => rooms.act(id, { action: 'published', gameId }),

  buildFailed: (id: string, text: string) => rooms.act(id, { action: 'build-failed', text }),

  /** Publish the model's question, with its options, to the whole room. */
  askedQuestion: (id: string, text: string, options: string[], messageId?: string) =>
    rooms.act(id, { action: 'asked', text, options, messageId }),

  delegationStatus: (id: string) =>
    rooms.act<{ armed: boolean; expiresAt: string | null; maxHours: number; available: boolean }>(
      id,
      { action: 'delegation-status' },
    ),

  delegate: (id: string, refreshToken: string, hours: number) =>
    rooms.act<{ ok: boolean; expiresInHours: number }>(id, {
      action: 'delegate',
      refreshToken,
      hours,
    }),

  revoke: (id: string) => rooms.act(id, { action: 'revoke' }),

  /** Store this account's sign-in so rooms it owns can build server-side. */
  linkToken: (refreshToken: string) =>
    call<{ linked: boolean }>('/link-token', { method: 'POST', body: { refreshToken } }),

  tokenLinked: () => call<{ linked: boolean; available: boolean }>('/link-token'),

  /** Credentials for a Supabase Realtime subscription, if it is configured. */
  realtimeCreds: (id: string) =>
    call<RealtimeCreds>(`/room-token?id=${encodeURIComponent(id)}`),
};

/** The host's refresh token, which only the browser build holds. */
export function localRefreshToken(): string | null {
  if (isTauri) return null;
  try {
    const raw = localStorage.getItem('nanogram.session');
    return raw ? ((JSON.parse(raw) as { refreshToken?: string }).refreshToken ?? null) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- stream --- */

export interface StreamHandlers {
  onEvent(event: RoomEvent): void;
  onPresence(members: RoomMember[]): void;
  onStatus(status: 'live' | 'reconnecting' | 'offline'): void;
}

export interface StreamOptions extends StreamHandlers {
  /** Read the caller's current cursor. Called again on every resync, so it is
   *  a function rather than a value — the cursor moves while we are connected. */
  since(): number;
  /** Published on the presence channel. Without it we cannot appear online. */
  me: PresenceMeta | null;
}

/**
 * Follow a room.
 *
 * Prefers Supabase Realtime: the event insert is itself the broadcast and
 * presence is handled by the channel, so an idle room costs nothing. Falls back
 * to the SSE endpoint when Realtime is not configured — which is the normal
 * case for local development with no Supabase project.
 *
 * Returns a function that stops the stream.
 */
export function streamRoom(roomId: string, opts: StreamOptions): () => void {
  let stopped = false;
  let stopInner: (() => void) | null = null;

  /** Pull anything that landed before we were listening, or while we weren't. */
  const resync = () => {
    void rooms
      .get(roomId, { since: opts.since() })
      .then((state) => {
        if (stopped) return;
        for (const event of state.events) opts.onEvent(event);
      })
      .catch(() => {
        /* the next event or reconnect will try again */
      });
  };

  void (async () => {
    let creds: RealtimeCreds | null = null;
    try {
      creds = await rooms.realtimeCreds(roomId);
    } catch {
      // Older deployment, or the endpoint is unreachable — SSE still works.
      creds = null;
    }
    if (stopped) return;

    if (creds?.available && creds.url && creds.anonKey && creds.token && opts.me) {
      const { subscribeRoom } = await import('./realtime');
      if (stopped) return;
      stopInner = subscribeRoom(
        { url: creds.url, anonKey: creds.anonKey, token: creds.token },
        roomId,
        opts.me,
        {
          onEvent: opts.onEvent,
          onPresence: opts.onPresence,
          onStatus: opts.onStatus,
          onResync: resync,
        },
      );
      return;
    }

    stopInner = streamViaSse(roomId, opts);
  })();

  return () => {
    stopped = true;
    stopInner?.();
  };
}

/**
 * SSE fallback.
 *
 * Each server stream ends deliberately after ~20s (serverless invocations are
 * time-limited), so reconnecting is the normal path, not the error path. The
 * cursor is a sequence number, so nothing is missed across the seam.
 *
 * Read with `fetch` rather than `EventSource` because EventSource cannot send
 * an Authorization header, which would push the access token into the query
 * string and from there into logs and history.
 */
function streamViaSse(roomId: string, handlers: StreamOptions): () => void {
  let stopped = false;
  let cursor = handlers.since();
  let controller: AbortController | null = null;
  let retry = 0;
  let timer: number | undefined;

  async function connect(): Promise<void> {
    if (stopped) return;

    // A hidden tab does not need live updates; on a phone this is the
    // difference between a normal battery drain and a hot pocket.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      timer = window.setTimeout(() => void connect(), 2000);
      return;
    }

    controller = new AbortController();
    try {
      const res = await fetch(
        `${BASE}/room-events?id=${encodeURIComponent(roomId)}&since=${cursor}`,
        { headers: await authHeaders(), signal: controller.signal },
      );
      if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

      handlers.onStatus('live');
      retry = 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line.
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          handleFrame(frame);
        }
      }
    } catch (e) {
      if (stopped || (e as Error).name === 'AbortError') return;
      handlers.onStatus('reconnecting');
      // Back off so an outage is not hammered, capped so recovery stays quick.
      retry = Math.min(retry + 1, 5);
    }

    if (stopped) return;
    const delay = retry === 0 ? 150 : Math.min(500 * 2 ** retry, 8000);
    timer = window.setTimeout(() => void connect(), delay);
  }

  function handleFrame(frame: string) {
    if (frame.startsWith(':')) return; // keepalive comment
    let name = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!data) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (name === 'event') {
      const event = parsed as RoomEvent;
      if (event.seq > cursor) cursor = event.seq;
      handlers.onEvent(event);
    } else if (name === 'presence') {
      handlers.onPresence((parsed as { members: RoomMember[] }).members ?? []);
    } else if (name === 'hello' || name === 'bye') {
      const seq = (parsed as { seq?: number }).seq;
      if (typeof seq === 'number' && seq > cursor) cursor = seq;
    }
  }

  void connect();

  // Reconnect immediately when the tab returns rather than waiting out a backoff.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      controller?.abort();
      window.clearTimeout(timer);
      retry = 0;
      void connect();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.clearTimeout(timer);
    controller?.abort();
    handlers.onStatus('offline');
  };
}

export type { PresenceMeta };
