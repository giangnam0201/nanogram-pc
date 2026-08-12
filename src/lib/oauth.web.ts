/* Browser sign-in with Google and Discord.
 *
 * Both providers verify where they are allowed to send the user back, and that
 * allowlist lives in Nanogram's own developer apps:
 *
 *   Discord  — redirect_uri must be registered on client 1509113076304052265.
 *              The one /config advertises (be.nanogram.app/auth/callback) is a
 *              Nanogram page, so a browser cannot read the code off it. Point
 *              VITE_DISCORD_REDIRECT at this deployment once Nanogram registers
 *              it, and the flow completes here.
 *   Google   — the origin must appear in the client's authorised JavaScript
 *              origins. Identity Services then hands us an ID token, which is
 *              exactly what v2/auth/google consumes.
 *
 * Until those entries exist the providers reject us, so both paths fail with a
 * message that says what is missing rather than something cryptic.
 */

import { apiError } from './transport';

export const GOOGLE_CLIENT_ID =
  '836741523444-qiqmtcvqolnd5i4mf2kbdc6ecm0h3pc2.apps.googleusercontent.com';

/** Set when Nanogram registers this deployment as a Discord redirect. */
export const DISCORD_REDIRECT: string | undefined = import.meta.env.VITE_DISCORD_REDIRECT;

const STATE_KEY = 'nanogram.oauth.state';

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------------------------------------------------------- google --- */

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (res: { credential?: string; error?: string }) => void;
        ux_mode?: string;
        auto_select?: boolean;
      }): void;
      prompt(listener?: (n: { isNotDisplayed(): boolean; isSkippedMoment(): boolean }) => void): void;
    };
  };
}

let googleScript: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (googleScript) return googleScript;
  googleScript = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://accounts.google.com/gsi/client';
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(apiError('network', 0, 'Could not reach Google sign-in'));
    document.head.appendChild(el);
  });
  return googleScript;
}

/** Resolve with a Google ID token, which `v2/auth/google` exchanges. */
export async function googleIdToken(): Promise<string> {
  await loadGoogleScript();
  const google = (window as unknown as { google?: GoogleIdentity }).google;
  if (!google) throw apiError('network', 0, 'Google sign-in is unavailable');

  return new Promise<string>((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      auto_select: false,
      callback: (res) => {
        if (res.credential) resolve(res.credential);
        else
          reject(
            apiError('api', 403, 'Google declined the sign-in for this site.'),
          );
      },
    });

    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        reject(
          apiError(
            'api',
            403,
            'Google sign-in is not enabled for this site yet. Use your email address instead.',
          ),
        );
      }
    });
  });
}

/* --------------------------------------------------------------- discord --- */

export function discordConfigured(): boolean {
  return !!DISCORD_REDIRECT;
}

/** Send the browser to Discord. Completion is handled by `consumeDiscordCode`. */
export function startDiscord(clientId: string): never {
  if (!DISCORD_REDIRECT) {
    throw apiError(
      'api',
      501,
      'Discord sign-in is not enabled for this site yet. Use your email address, or the desktop app.',
    );
  }

  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify email');
  url.searchParams.set('state', state);

  location.assign(url.toString());
  throw apiError('network', 0, 'Redirecting to Discord…');
}

/**
 * If we came back from Discord, return the authorisation code once and clear it
 * from the address bar so a refresh cannot replay it.
 */
export function consumeDiscordCode(): { code: string; redirectUri: string } | null {
  if (!DISCORD_REDIRECT) return null;

  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code) return null;

  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  // Strip the query either way — a replayed code is useless and confusing.
  history.replaceState(null, '', location.pathname);

  if (!expected || expected !== state) return null;
  return { code, redirectUri: DISCORD_REDIRECT };
}
