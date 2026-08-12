/* Exchange the caller's Nanogram token for CloudFront signed cookies, and
 * re-issue them as first-party cookies on this deployment.
 *
 * The browser cannot do this itself: cf-cookies.nanogram.app rejects the CORS
 * preflight, and <img>/<iframe> cannot carry an Authorization header. Handing
 * the token over once, here, keeps it out of URLs entirely — a `?token=` query
 * string would leak into history, referrers and edge logs.
 */

export const config = { runtime: 'edge' };

const COOKIE_ENDPOINT = 'https://cf-cookies.nanogram.app/cookie';

const CF_COOKIES = ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'];

/** Local cookie name for an upstream CloudFront cookie. */
export function localName(cfName: string): string {
  return 'ngcf_' + cfName.replace('CloudFront-', '').replace(/-/g, '_').toLowerCase();
}

/** Pull `name=value` pairs out of a response's Set-Cookie headers. */
function readSetCookies(res: Response): Record<string, string> {
  const headers = res.headers as unknown as { getSetCookie?: () => string[] };
  const raw =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : // Split on commas that start a new `name=` pair, not those inside dates.
        (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;=,]+=)/);

  const out: Record<string, string> = {};
  for (const cookie of raw) {
    const first = cookie.split(';')[0]?.trim();
    if (!first) continue;
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    out[first.slice(0, idx)] = first.slice(idx + 1);
  }
  return out;
}

function json(body: unknown, status: number, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'missing authorization' }, 401);

  const upstream = await fetch(COOKIE_ENDPOINT, { headers: { Authorization: auth } });
  if (!upstream.ok) return json({ error: 'cookie exchange failed' }, upstream.status);

  const body = (await upstream.json().catch(() => ({}))) as { expires_in?: number };
  const maxAge = Math.max(60, Math.min(body.expires_in ?? 3600, 86400));

  const cookies = readSetCookies(upstream);
  const headers = new Headers();
  let issued = 0;

  for (const cfName of CF_COOKIES) {
    const value = cookies[cfName];
    if (!value) continue;
    issued++;
    // Path covers both this route and /api/cdn; the page is same-origin, so
    // Lax is sufficient and keeps the cookie out of third-party contexts.
    headers.append(
      'Set-Cookie',
      `${localName(cfName)}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    );
  }

  if (issued === 0) return json({ error: 'no cookies returned' }, 502);

  return json({ ok: true, expiresIn: maxAge }, 200, headers);
}
