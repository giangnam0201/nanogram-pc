/* Supabase access from the Edge runtime.
 *
 * Two separate concerns live here:
 *
 *  1. `sb()` — PostgREST calls with the service role key, used for every read
 *     and write the API performs. Service role bypasses RLS, which is why the
 *     key must never reach a browser.
 *
 *  2. `mintRealtimeToken()` — a short-lived HS256 JWT carrying the caller's
 *     already-verified Nanogram id in an `ng_user` claim. Clients use it only
 *     to subscribe to Realtime; the RLS policies in supabase/schema.sql resolve
 *     that claim to decide which rooms they may see.
 *
 * Deliberately no @supabase/supabase-js on the server: PostgREST is plain HTTP
 * and the SDK would be dead weight in an Edge bundle.
 */

const URL_ENV = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
/* Realtime authenticates the *connection* with a project API key and the *user*
   with a JWT. They are not interchangeable: the gateway rejects a minted user
   token supplied as apikey. The Vercel-Supabase integration provides this as
   SUPABASE_ANON_KEY; a new-style publishable key works equally well. */
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

export const hasSupabase = Boolean(URL_ENV && SERVICE_KEY);
/** Realtime needs the JWT secret (to authorise the user) and a project API key
 *  (to authorise the connection). Missing either means falling back to SSE. */
export const hasRealtime = Boolean(hasSupabase && JWT_SECRET && ANON_KEY);

export function anonKey(): string {
  return ANON_KEY ?? '';
}

/** Realtime speaks WebSocket, so the endpoint must carry a ws scheme — the
 *  client's own helper only converts in the other direction. */
export function realtimeUrl(): string {
  return `${supabaseUrl()}/realtime/v1`.replace(/^http/i, 'ws');
}

export function supabaseUrl(): string {
  return (URL_ENV ?? '').replace(/\/$/, '');
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Options {
  /** PostgREST query string, e.g. `select=*&room_id=eq.123&order=id.asc`. */
  query?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Prefer header, e.g. `return=representation` or `resolution=merge-duplicates`. */
  prefer?: string;
}

/** One PostgREST request against `table`. */
export async function sb<T>(table: string, opts: Options = {}): Promise<T> {
  if (!hasSupabase) throw new DbError('Supabase is not configured', 503);

  const url = `${supabaseUrl()}/rest/v1/${table}${opts.query ? `?${opts.query}` : ''}`;
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.prefer) headers.Prefer = opts.prefer;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  if (!res.ok) {
    let message = `supabase ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: string; hint?: string };
      message = parsed.message ?? message;
      if (parsed.hint) message += ` (${parsed.hint})`;
    } catch {
      /* keep the status-code message */
    }
    throw new DbError(message, res.status);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** First row, or null. PostgREST always answers with an array. */
export async function sbOne<T>(table: string, opts: Options = {}): Promise<T | null> {
  const rows = await sb<T[]>(table, opts);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

/* ----------------------------------------------------------- rpc + jwt --- */

export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!hasSupabase) throw new DbError('Supabase is not configured', 503);
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY as string,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new DbError(`supabase rpc ${name}: ${res.status}`, res.status);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * A short-lived Supabase JWT for one verified Nanogram user.
 *
 * Short-lived on purpose: it is the client's only credential for Realtime, and
 * membership can be revoked, so it should stop working soon after rather than
 * outliving the session that earned it.
 */
export async function mintRealtimeToken(
  ngUserId: string,
  ttlSeconds = 3600,
): Promise<{ token: string; expiresAt: number }> {
  if (!hasRealtime) throw new DbError('Realtime is not configured', 503);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    // `authenticated` is the role the RLS policies are evaluated as.
    role: 'authenticated',
    // Not an auth.users id — the policies read ng_user, never auth.uid().
    ng_user: ngUserId,
    iat: now,
    exp,
  };

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET as string),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );

  return {
    token: `${signingInput}.${base64url(new Uint8Array(signature))}`,
    expiresAt: exp * 1000,
  };
}
