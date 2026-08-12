import { invoke } from '@tauri-apps/api/core';

export interface ApiError {
  kind: 'network' | 'unauthorized' | 'api' | 'decode';
  status: number;
  code: string | null;
  message: string;
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}

export interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

/** Authenticated call. Rust attaches and refreshes the bearer token. */
export function request<T>(spec: RequestSpec): Promise<T> {
  return invoke<T>('api_request', { spec });
}

/** Login endpoints — Rust adopts the returned token pair. */
export function authRequest<T>(spec: RequestSpec): Promise<T> {
  return invoke<T>('api_auth_request', { spec });
}

export interface SessionState {
  loggedIn: boolean;
  userId: string | null;
}

export const ipc = {
  sessionState: () => invoke<SessionState>('session_state'),
  logout: () => invoke<void>('logout'),
  gameUrl: (gameId: string) => invoke<string>('game_url', { gameId }),
  shareUrl: (gameId: string) => invoke<string>('share_url', { gameId }),
  inviteUrl: (code: string) => invoke<string>('invite_url', { code }),
  gameToken: () => invoke<string | null>('game_token'),
  loginDiscord: () => invoke<unknown>('login_discord'),
  loginGoogle: () => invoke<unknown>('login_google'),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(e)) return e.message || fallback;
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}
