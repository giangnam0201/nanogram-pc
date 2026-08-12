import { isTauri } from './transport';
import { CDN_PROXY } from './transport.web';

/* Everything under games/pictures.nanogram.app is behind a CloudFront
   distribution that demands signed cookies — fetched straight, every asset
   answers 403 MissingKey.

   Desktop: Rust holds the cookies and proxies via the `cdn:` scheme.
   Web: a serverless function does the same at /api/cdn, using a first-party
   cookie so <img> and <iframe> work without an Authorization header.

   be.nanogram.app needs no signature, but sets
   `frame-ancestors 'self' https://*.nanogram.app`, so it is proxied purely to
   drop that header and make the feed embeddable. */

const PROXIED_HOSTS = new Set([
  'games.nanogram.app',
  'pictures.nanogram.app',
  'nanogram.app',
  // Unsigned, but its CSP allows framing only from *.nanogram.app, so it has
  // to come through the proxy to be embeddable at all.
  'be.nanogram.app',
]);

/** Windows serves custom schemes over `http://<scheme>.localhost`. */
const isWindows = /Windows/i.test(navigator.userAgent);

function tauriBase(): string {
  return isWindows ? 'http://cdn.localhost/' : 'cdn://localhost/';
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

  const target = `${parsed.hostname}${parsed.pathname}${parsed.search}`;

  if (isTauri) {
    // encodeURI, not encodeURIComponent: the Rust handler splits on '/'.
    return `${tauriBase()}${encodeURI(target)}`;
  }

  if (!CDN_PROXY) return url; // hosted without a proxy — let it try directly
  // Passed as a query param: Vercel resolves path segments that look like
  // files against static output before any function sees them.
  return `${CDN_PROXY}/cdn?u=${encodeURIComponent(target)}`;
}
