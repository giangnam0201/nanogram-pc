/* Desktop transport: every call crosses into Rust, which owns the session and
   never hands a token to the webview. */

import { invoke } from '@tauri-apps/api/core';
import type { RequestSpec, SessionState, Transport } from './transport';

const isWindows = /Windows/i.test(navigator.userAgent);

export const tauriTransport: Transport = {
  request: <T,>(spec: RequestSpec) => invoke<T>('api_request', { spec }),
  authRequest: <T,>(spec: RequestSpec) => invoke<T>('api_auth_request', { spec }),

  sessionState: () => invoke<SessionState>('session_state'),
  logout: () => invoke<void>('logout'),

  gameUrl: (gameId: string) => invoke<string>('game_url', { gameId }),
  shareUrl: (gameId: string) => invoke<string>('share_url', { gameId }),
  inviteUrl: (code: string) => invoke<string>('invite_url', { code }),
  gameToken: () => invoke<string | null>('game_token'),

  loginGoogle: () => invoke<unknown>('login_google'),
  loginDiscord: () => invoke<unknown>('login_discord'),

  openExternal: (url: string) => invoke<void>('open_external', { url }),

  stagePreview: (html: string) => invoke<string>('stage_preview', { html }),
  previewSrc: (id: string) =>
    isWindows ? `http://preview.localhost/${id}` : `preview://localhost/${id}`,
};
