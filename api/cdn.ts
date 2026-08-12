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
  // Feed games. Unsigned, but their CSP allows framing only from
  // *.nanogram.app, so they must be proxied to be embeddable at all.
  'be.nanogram.app',
]);

/** Unsigned hosts whose HTML may use relative asset paths. */
const UNSIGNED_HOSTS = new Set(['be.nanogram.app']);

/** Keep relative URLs in proxied HTML resolving against the real origin. */
function injectBase(html: string, origin: string, pathname: string): string {
  const dir = pathname.slice(0, pathname.lastIndexOf('/') + 1);
  const tag = `<base href="${origin}${dir}">`;
  const head = html.indexOf('<head>');
  if (head === -1) return tag + html;
  const at = head + '<head>'.length;
  return html.slice(0, at) + tag + html.slice(at);
}

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
  for (const name of ['content-type', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Signed URLs expire, so never let a shared cache hold these. Upstream CSP
  // and X-Frame-Options are deliberately not forwarded: dropping
  // `frame-ancestors` is the whole reason feed games come through here.
  headers.set('Cache-Control', upstream.ok ? 'private, max-age=300' : 'no-store');

  const contentType = upstream.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/html') && UNSIGNED_HOSTS.has(upstreamUrl.hostname)) {
    const html = await upstream.text();
    const patched = injectBase(html, upstreamUrl.origin, upstreamUrl.pathname);
    return new Response(patched, { status: upstream.status, headers });
  }

  const length = upstream.headers.get('content-length');
  if (length) headers.set('content-length', length);
  return new Response(upstream.body, { status: upstream.status, headers });
}
