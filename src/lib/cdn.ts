import { isTauri } from './transport';
import { CDN_PROXY } from './transport.web';

/* Everything under games/pictures.nanogram.app is behind a CloudFront
   distribution that demands signed cookies — fetched straight, every asset
   answers 403 MissingKey.

   Desktop: Rust holds the cookies and proxies via the `cdn:` scheme.
   Web: a serverless function does the same at /api/cdn, using a first-party
   cookie so <img> and <iframe> work without an Authorization header.

   be.nanogram.app is deliberately absent: it sits behind Cloudflare, serves
   feed games unsigned, and is faster loaded directly. */

const PROXIED_HOSTS = new Set([
  'games.nanogram.app',
  'pictures.nanogram.app',
  'nanogram.app',
]);

/** Windows serves custom schemes over `http://<scheme>.localhost`. */
const isWindows = /Windows/i.test(navigator.userAgent);

function base(): string {
  if (isTauri) return isWindows ? 'http://cdn.localhost/' : 'cdn://localhost/';
  return CDN_PROXY ? `${CDN_PROXY}/` : '';
}

/**
 * Rewrite a CDN URL onto whichever proxy this build has. Anything else is
 * returned untouched, so third-party avatars still load directly.
 */
export function cdnUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.protocol !== 'https:' || !PROXIED_HOSTS.has(parsed.hostname)) {
    return url;
  }

  const prefix = base();
  if (!prefix) return url; // no proxy available — let it try directly

  // encodeURI, not encodeURIComponent: path separators must survive so the
  // handler can split host from path.
  const target = encodeURI(`${parsed.hostname}${parsed.pathname}`);
  return `${prefix}${target}${parsed.search}`;
}
