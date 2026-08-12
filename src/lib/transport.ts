/* One API surface, two backends.
   In the desktop app every call is handed to Rust, which owns the tokens. On
   the web there is no Rust, so the same calls run in the browser against
   api.nanogram.app (which serves permissive CORS) with the session in
   localStorage. Screens never know which one they are talking to. */

export const isTauri =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);

export interface ApiError {
  kind: 'network' | 'unauthorized' | 'api' | 'decode';
  status: number;
  code: string | null;
  message: string;
}

export interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export interface SessionState {
  loggedIn: boolean;
  userId: string | null;
}

export interface Transport {
  request<T>(spec: RequestSpec): Promise<T>;
  authRequest<T>(spec: RequestSpec): Promise<T>;
  sessionState(): Promise<SessionState>;
  logout(): Promise<void>;
  gameUrl(gameId: string): Promise<string>;
  shareUrl(gameId: string): Promise<string>;
  inviteUrl(code: string): Promise<string>;
  gameToken(): Promise<string | null>;
  loginGoogle(): Promise<unknown>;
  loginDiscord(): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  stagePreview(html: string): Promise<string>;
  /** Resolve a preview id to something an iframe can load. */
  previewSrc(id: string): string;
}

export const API_BASE = 'https://api.nanogram.app/';

/** Paths the server rejects when they carry a stale bearer token. */
const UNAUTHENTICATED = [
  'auth/login',
  'auth/refresh',
  'auth/google',
  'auth/email/request',
  'auth/email/verify',
];

export function isUnauthenticatedPath(path: string): boolean {
  return UNAUTHENTICATED.some((p) => path.includes(p));
}

export function apiError(
  kind: ApiError['kind'],
  status: number,
  message: string,
  code: string | null = null,
): ApiError {
  return { kind, status, code, message };
}

/** Mirrors the Rust parser: the API is not consistent about error envelopes. */
export function readError(status: number, text: string): ApiError {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    const trimmed = text.trim();
    return apiError('api', status, trimmed || `Request failed (${status})`);
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const nested =
    obj.error && typeof obj.error === 'object' ? (obj.error as Record<string, unknown>) : obj;

  const str = (source: Record<string, unknown>, key: string): string | null => {
    const v = source[key];
    return typeof v === 'string' && v ? v : null;
  };

  const code = str(nested, 'code') ?? str(obj, 'code');

  let message =
    str(nested, 'message') ?? str(nested, 'detail') ?? str(obj, 'message') ?? str(obj, 'error');

  if (!message) {
    const list = (obj.errors ?? obj.issues) as unknown;
    if (Array.isArray(list)) {
      const parts = list
        .map((item) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          const msg = typeof entry.message === 'string' ? entry.message : '';
          const field =
            typeof entry.field === 'string'
              ? entry.field
              : typeof entry.path === 'string'
                ? entry.path
                : null;
          if (!msg) return null;
          return field ? `${field}: ${msg}` : msg;
        })
        .filter(Boolean);
      if (parts.length) message = parts.join(', ');
    }
  }

  return apiError('api', status, message ?? `Request failed (${status})`, code);
}

export function buildUrl(path: string, query?: RequestSpec['query']): string {
  const url = new URL(path.replace(/^\//, ''), API_BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
