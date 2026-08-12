import { isTauri, type ApiError, type RequestSpec, type SessionState } from './transport';
import { tauriTransport } from './transport.tauri';
import { webTransport } from './transport.web';

export type { ApiError, RequestSpec, SessionState };

/** Desktop talks to Rust; the browser talks to the API directly. */
const transport = isTauri ? tauriTransport : webTransport;

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}

/** Authenticated call. Credentials are attached and refreshed for us. */
export function request<T>(spec: RequestSpec): Promise<T> {
  return transport.request<T>(spec);
}

/** Login endpoints — the returned token pair is adopted. */
export function authRequest<T>(spec: RequestSpec): Promise<T> {
  return transport.authRequest<T>(spec);
}

export const ipc = {
  sessionState: () => transport.sessionState(),
  logout: () => transport.logout(),
  gameUrl: (gameId: string) => transport.gameUrl(gameId),
  shareUrl: (gameId: string) => transport.shareUrl(gameId),
  inviteUrl: (code: string) => transport.inviteUrl(code),
  gameToken: () => transport.gameToken(),
  loginDiscord: () => transport.loginDiscord(),
  loginGoogle: () => transport.loginGoogle(),
  openExternal: (url: string) => transport.openExternal(url),
  stagePreview: (html: string) => transport.stagePreview(html),
  previewSrc: (id: string) => transport.previewSrc(id),
};

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(e)) return e.message || fallback;
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}
