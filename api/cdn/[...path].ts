/* Vercel serverless media proxy.
 *
 * CloudFront serves games and thumbnails only to requests carrying signed
 * cookies, which the browser cannot obtain itself: cf-cookies.nanogram.app
 * rejects the CORS preflight, and <img>/<iframe> cannot send an Authorization
 * header anyway.
 *
 * So the exchange happens here:
 *   POST /api/cdn/session   with a bearer token, once per sign-in
 *                           -> stores the CloudFront cookies as first-party,
 *                              HttpOnly cookies on this deployment's origin
 *   GET  /api/cdn/<host>/<path>
 *                           -> replays those cookies upstream and streams back
 *
 * The user's access token is never placed in a URL, so it stays out of browser
 * history, referrer headers and edge logs.
 */

export const config = { runtime: 'edge' };

const COOKIE_ENDPOINT = 'https://cf-cookies.nanogram.app/cookie';

/** Only Nanogram's own CDN hosts, so this cannot be used as an open relay. */
const ALLOWED_HOSTS = new Set([
  'games.nanogram.app',
  'pictures.nanogram.app',
  'nanogram.app',
]);

const CF_COOKIES = ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'];

/** Our own cookie names, so they cannot collide with anything upstream. */
const LOCAL_PREFIX = 'ngcf_';

function localName(cfName: string): string {
  return LOCAL_PREFIX + cfName.replace('CloudFront-', '').replace(/-/g, '_').toLowerCase();
}

function readCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) out[name] = rest.join('=');
  }
  return out;
}

/** Exchange the caller's bearer token for CloudFront cookies. */
async function establishSession(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!auth) {
    return new Response(JSON.stringify({ error: 'missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstream = await fetch(COOKIE_ENDPOINT, { headers: { Authorization: auth } });
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: 'cookie exchange failed' }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await upstream.json().catch(() => ({}))) as { expires_in?: number };
  const maxAge = Math.max(60, Math.min(body.expires_in ?? 3600, 86400));

  const setCookies = readSetCookies(upstream);
  const headers = new Headers({ 'Content-Type': 'application/json' });

  for (const cfName of CF_COOKIES) {
    const value = setCookies[cfName];
    if (!value) continue;
    // Same-site: the page and this function share an origin, so Lax is enough
    // and keeps the cookie out of third-party contexts.
    headers.append(
      'Set-Cookie',
      `${localName(cfName)}=${value}; Path=/api/cdn; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    );
  }

  return new Response(JSON.stringify({ ok: true, expiresIn: maxAge }), { status: 200, headers });
}

/** Pull `name=value` pairs out of an upstream response's Set-Cookie headers. */
function readSetCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  // getSetCookie() is available on the edge runtime; fall back to the raw header.
  const raw =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/);

  for (const cookie of raw) {
    const first = cookie.split(';')[0]?.trim();
    if (!first) continue;
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    out[first.slice(0, idx)] = first.slice(idx + 1);
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/api\/cdn\/?/, '');

  if (rest === 'session') {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    return establishSession(req);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }

  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash + 1);

  if (!ALLOWED_HOSTS.has(host)) {
    return new Response('host not allowed', { status: 403 });
  }

  const jar = readCookies(req.headers.get('cookie'));
  const cookieHeader = CF_COOKIES.map((name) => {
    const value = jar[localName(name)];
    return value ? `${name}=${value}` : null;
  })
    .filter(Boolean)
    .join('; ');

  const target = `https://${host}/${path}${url.search}`;
  const upstream = await fetch(target, {
    method: req.method,
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });

  const headers = new Headers();
  const passthrough = ['content-type', 'content-length', 'etag', 'last-modified'];
  for (const name of passthrough) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', upstream.ok ? 'public, max-age=300' : 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
