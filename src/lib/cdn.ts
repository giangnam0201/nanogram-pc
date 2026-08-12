/* Everything under *.nanogram.app is behind a CloudFront distribution that
   demands signed cookies — fetched straight, every asset answers 403
   MissingKey. Rust holds those cookies and proxies the traffic, so the webview
   asks for `cdn:` URLs instead of hitting CloudFront itself. */

const PROXIED_HOSTS = new Set([
  'games.nanogram.app',
  'pictures.nanogram.app',
  'nanogram.app',
]);

/** Windows serves custom schemes over `http://<scheme>.localhost`. */
const isWindows = /Windows/i.test(navigator.userAgent);

function proxyBase(): string {
  return isWindows ? 'http://cdn.localhost/' : 'cdn://localhost/';
}

/**
 * URL for a staged GameGen build. Previews get their own origin so the app's
 * `script-src 'self'` does not silently kill the game's inline scripts, which
 * is what an `srcdoc` iframe would inherit.
 */
export function previewUrl(id: string): string {
  return isWindows ? `http://preview.localhost/${id}` : `preview://localhost/${id}`;
}

/**
 * Rewrite a CDN URL onto the local proxy. Anything else is returned untouched,
 * so avatars on third-party hosts still load directly.
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

  // encodeURI, not encodeURIComponent — the path separators must survive so
  // the Rust handler can split host from path.
  const target = encodeURI(`${parsed.hostname}${parsed.pathname}`);
  return `${proxyBase()}${target}${parsed.search}`;
}
