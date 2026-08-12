/* Stream a CloudFront-signed asset, replaying the first-party cookies minted by
 * /api/cdn-session.
 *
 * The target arrives as `?u=<host>/<path>` rather than in the URL path. Vercel
 * resolves path segments that look like files (…/thumbnail.png) against the
 * static output first, so a catch-all route never sees them — the request 404s
 * before any function runs. A query parameter sidesteps that entirely.
 */

export const config = { runtime: 'edge' };

const CF_COOKIES = ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'];

/** Only Nanogram's own CDN hosts, so this cannot become an open relay. */
const ALLOWED_HOSTS = new Set([
  'games.nanogram.app',
  'pictures.nanogram.app',
  'nanogram.app',
]);

function localName(cfName: string): string {
  return 'ngcf_' + cfName.replace('CloudFront-', '').replace(/-/g, '_').toLowerCase();
}

function readCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('u');
  if (!target) return new Response('missing target', { status: 400 });

  // `u` is `<host>/<path>[?query]`; parse it as a URL to validate the host.
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(`https://${target.replace(/^\/+/, '')}`);
  } catch {
    return new Response('bad target', { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(upstreamUrl.hostname)) {
    return new Response('host not allowed', { status: 403 });
  }

  const jar = readCookies(req.headers.get('cookie'));
  const cookieHeader = CF_COOKIES.map((name) => {
    const value = jar[localName(name)];
    return value ? `${name}=${value}` : null;
  })
    .filter(Boolean)
    .join('; ');

  const upstream = await fetch(upstreamUrl.toString(), {
    method: req.method,
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    redirect: 'follow',
  });

  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Signed URLs expire, so never let a shared cache hold these.
  headers.set('Cache-Control', upstream.ok ? 'private, max-age=300' : 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
