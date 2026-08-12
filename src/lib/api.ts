/* One function per Nanogram endpoint. Paths, verbs and parameter names are
   copied from the Android Retrofit services (docs/api-endpoints.txt). */

import { authRequest, request } from './ipc';
import type * as T from './types';

const PAGE = 20;

/* ---------------------------------------------------------------- auth --- */

export const auth = {
  requestEmailOtp: (email: string) =>
    authRequest<unknown>({ method: 'POST', path: 'v2/auth/email/request', body: { email } }),

  verifyEmailOtp: (email: string, code: string) =>
    authRequest<T.TokenPair>({ method: 'POST', path: 'v2/auth/email/verify', body: { email, code } }),

  checkUsername: (username: string) =>
    request<T.Availability>({ method: 'GET', path: 'auth/check-username', query: { username } }),

  completeOnboarding: (body: {
    username: string;
    dateOfBirth?: string | null;
    ageRange?: { lower: number; upper?: number | null } | null;
    referralCode: string;
    nanotag: { colorPreset: string; chaosPercentage: number };
  }) => authRequest<unknown>({ method: 'POST', path: 'v2/auth/onboarding', body }),

  setDateOfBirth: (dateOfBirth: string) =>
    request<unknown>({ method: 'POST', path: 'auth/date-of-birth', body: { dateOfBirth } }),

  claimReferral: (referralCode: string) =>
    request<unknown>({ method: 'POST', path: 'v2/me/referral', body: { referralCode } }),

  config: () => request<T.ClientConfig>({ method: 'GET', path: 'config' }),
};

/* ---------------------------------------------------------------- feed --- */

export const feed = {
  list: (count = 10, userId?: string) =>
    request<T.FeedResponse>({ method: 'GET', path: 'games/feed', query: { count, userId } }),

  /** The Android client calls this to record a view and read fresh counters. */
  stats: (id: string, userId?: string) =>
    request<T.GameStats>({ method: 'GET', path: `games/${id}/stats`, query: { userId } }),
};

/* --------------------------------------------------------------- games --- */

export const games = {
  get: (id: string) => request<T.GameV2>({ method: 'GET', path: `v2/games/${id}` }),

  like: (id: string) => request<T.LikeResponse>({ method: 'POST', path: `v2/games/${id}/like` }),
  unlike: (id: string) => request<T.LikeResponse>({ method: 'DELETE', path: `v2/games/${id}/like` }),

  save: (id: string) => request<T.SaveResponse>({ method: 'POST', path: `v2/games/${id}/save` }),
  unsave: (id: string) => request<T.SaveResponse>({ method: 'DELETE', path: `v2/games/${id}/save` }),

  /** Records the share and returns the updated share counter. */
  share: (id: string) => request<T.ShareResponse>({ method: 'POST', path: `v2/games/${id}/share` }),

  /** Attribution when someone opens a shared link. */
  shareClick: (id: string, sharerCode: string) =>
    request<unknown>({ method: 'POST', path: `v2/games/${id}/share-click`, body: { sharerCode } }),

  rename: (id: string, title: string) =>
    request<unknown>({ method: 'PATCH', path: `v2/games/${id}`, body: { title } }),

  remove: (id: string) => request<unknown>({ method: 'DELETE', path: `v2/games/${id}` }),

  report: (id: string, reason: string) =>
    request<unknown>({ method: 'POST', path: `v2/games/${id}/report`, body: { reason } }),
};

/* ------------------------------------------------------------ discover --- */

export const discover = {
  sections: () => request<T.DiscoverResponse>({ method: 'GET', path: 'v2/discover' }),

  leaderboard: () => request<T.LeaderboardResponse>({ method: 'GET', path: 'v2/games/leaderboard' }),

  searchGames: (q: string, cursor?: string, limit = PAGE) =>
    request<T.GameSearchResponse>({ method: 'GET', path: 'v2/games/search', query: { q, limit, cursor } }),

  searchUsers: (q: string, cursor?: string, limit = PAGE) =>
    request<T.UserSearchResponse>({ method: 'GET', path: 'v2/users/search', query: { q, limit, cursor } }),

  genres: () => request<T.Genre[]>({ method: 'GET', path: 'v2/genres' }),

  genreGames: (genreId: string, cursor?: string, limit = PAGE) =>
    request<T.GenreGamesResponse>({
      method: 'GET',
      path: `v2/genres/${genreId}/games`,
      query: { limit, cursor },
    }),
};

/* ------------------------------------------------------------- profile --- */

export const profile = {
  me: () => request<T.Me>({ method: 'GET', path: 'v2/me' }),

  patchMe: (body: { username?: string; nanotag?: { colorPreset: string; chaosPercentage: number } }) =>
    request<T.Me>({ method: 'PATCH', path: 'v2/me', body }),

  myGames: (cursor?: string, limit = PAGE) =>
    request<T.MeGamesResponse>({ method: 'GET', path: 'v2/me/games', query: { limit, cursor } }),

  saved: (cursor?: string, limit = PAGE) =>
    request<T.MeGamesResponse>({ method: 'GET', path: 'v2/me/saved', query: { limit, cursor } }),

  user: (userId: string) => request<T.UserProfile>({ method: 'GET', path: `v2/users/${userId}` }),

  userGames: (userId: string, cursor?: string, limit = PAGE) =>
    request<T.MeGamesResponse>({
      method: 'GET',
      path: `v2/users/${userId}/games`,
      query: { limit, cursor },
    }),

  followers: (userId: string, cursor?: string, limit = PAGE) =>
    request<T.FollowListResponse>({
      method: 'GET',
      path: `v2/users/${userId}/followers`,
      query: { limit, cursor },
    }),

  following: (userId: string, cursor?: string, limit = PAGE) =>
    request<T.FollowListResponse>({
      method: 'GET',
      path: `v2/users/${userId}/following`,
      query: { limit, cursor },
    }),

  follow: (userId: string) =>
    request<T.FollowResponse>({ method: 'POST', path: `v2/users/${userId}/follow` }),
  unfollow: (userId: string) =>
    request<T.FollowResponse>({ method: 'DELETE', path: `v2/users/${userId}/follow` }),

  reportUser: (userId: string, reason: string) =>
    request<unknown>({ method: 'POST', path: `v2/users/${userId}/report`, body: { reason } }),

  block: (userId: string) => request<unknown>({ method: 'POST', path: 'v2/blocks', body: { userId } }),
  unblock: (userId: string) => request<unknown>({ method: 'DELETE', path: `v2/blocks/${userId}` }),

  achievements: () => request<unknown>({ method: 'GET', path: 'v2/me/achievements' }),
  credits: () => request<T.Credits>({ method: 'GET', path: 'v2/gamegen/credits' }),
};

/* ------------------------------------------------------------ comments --- */

export const comments = {
  list: (gameId: string, cursor?: string, limit = PAGE) =>
    request<T.CommentListResponse>({
      method: 'GET',
      path: `v2/games/${gameId}/comments`,
      query: { limit, cursor },
    }),

  create: (gameId: string, body: { body?: string; parentId?: string; giphyId?: string; giphyUrl?: string }) =>
    request<T.CreateCommentResponse>({ method: 'POST', path: `v2/games/${gameId}/comments`, body }),

  remove: (gameId: string, commentId: string) =>
    request<unknown>({ method: 'DELETE', path: `v2/games/${gameId}/comments/${commentId}` }),

  like: (gameId: string, commentId: string) =>
    request<{ isLiked?: boolean | null; likesCount?: number | null }>({
      method: 'POST',
      path: `v2/games/${gameId}/comments/${commentId}/like`,
    }),

  unlike: (gameId: string, commentId: string) =>
    request<{ isLiked?: boolean | null; likesCount?: number | null }>({
      method: 'DELETE',
      path: `v2/games/${gameId}/comments/${commentId}/like`,
    }),

  replies: (gameId: string, commentId: string, cursor?: string, limit = PAGE) =>
    request<{ replies?: T.Comment[] | null; nextCursor?: string | null }>({
      method: 'GET',
      path: `v2/games/${gameId}/comments/${commentId}/replies`,
      query: { limit, cursor },
    }),

  report: (gameId: string, commentId: string, reason: string) =>
    request<unknown>({
      method: 'POST',
      path: `v2/games/${gameId}/comments/${commentId}/report`,
      body: { reason },
    }),
};

/* ---------------------------------------------------------------- chat --- */

export const chat = {
  list: (cursor?: string, limit = PAGE) =>
    request<T.ChatListResponse>({ method: 'GET', path: 'v2/chats', query: { cursor, limit } }),

  requests: (cursor?: string, limit = PAGE) =>
    request<T.ChatListResponse>({ method: 'GET', path: 'v2/chats/requests', query: { cursor, limit } }),

  get: (chatId: string) => request<T.Chat>({ method: 'GET', path: `v2/chats/${chatId}` }),

  create: (recipientId: string) =>
    request<T.Chat>({ method: 'POST', path: 'v2/chats', body: { recipientId } }),

  messages: (chatId: string, cursor?: string, limit = 30) =>
    request<T.ChatMessagesResponse>({
      method: 'GET',
      path: `v2/chats/${chatId}/messages`,
      query: { cursor, limit },
    }),

  send: (chatId: string, body: { text?: string; gameId?: string; replyToId?: string; clientNonce: string }) =>
    request<T.ChatMessage>({ method: 'POST', path: `v2/chats/${chatId}/messages`, body }),

  markRead: (chatId: string, messageId: string) =>
    request<unknown>({ method: 'POST', path: `v2/chats/${chatId}/read`, body: { messageId } }),

  accept: (chatId: string) => request<T.Chat>({ method: 'POST', path: `v2/chats/${chatId}/accept` }),

  typing: (chatId: string) => request<unknown>({ method: 'POST', path: `v2/chats/${chatId}/typing` }),

  remove: (chatId: string) => request<unknown>({ method: 'DELETE', path: `v2/chats/${chatId}` }),

  deleteMessage: (chatId: string, messageId: string, forEveryone = false) =>
    request<unknown>({
      method: 'DELETE',
      path: `v2/chats/${chatId}/messages/${messageId}${forEveryone ? '/all' : ''}`,
    }),

  search: (q: string) => request<unknown>({ method: 'GET', path: 'v2/chats/search', query: { q } }),

  friends: (cursor?: string, limit = PAGE) =>
    request<T.FriendsResponse>({ method: 'GET', path: 'v2/me/friends', query: { limit, cursor } }),

  searchFriends: (q: string, cursor?: string, limit = PAGE) =>
    request<T.FriendsResponse>({ method: 'GET', path: 'v2/me/friends/search', query: { q, limit, cursor } }),
};

/* ------------------------------------------------------- notifications --- */

export const notifications = {
  list: (cursor?: string, limit = PAGE) =>
    request<T.NotificationsResponse>({ method: 'GET', path: 'v2/notifications', query: { cursor, limit } }),

  unreadCount: () => request<{ count?: number | null }>({ method: 'GET', path: 'notifications/unread-count' }),

  markRead: (notificationId: string) =>
    request<unknown>({ method: 'POST', path: 'notifications/read', body: { notificationId } }),

  markAllRead: () => request<unknown>({ method: 'POST', path: 'notifications/read-all' }),
};

/* ------------------------------------------------------------- gamegen --- */

export const gamegen = {
  styles: () => request<{ styles?: T.GameGenStyle[] | null }>({ method: 'GET', path: 'v2/gamegen/styles' }),

  sessions: (cursor?: string, limit = PAGE) =>
    request<T.SessionsResponse>({ method: 'GET', path: 'v2/gamegen/sessions', query: { cursor, limit } }),

  createSession: (body: { styleId: string; dimension?: string; description?: string; remixHtml: string }) =>
    request<T.CreateSessionResponse>({ method: 'POST', path: 'v2/gamegen/sessions', body }),

  deleteSession: (id: string) => request<unknown>({ method: 'DELETE', path: `v2/gamegen/sessions/${id}` }),

  messages: (id: string) =>
    request<T.MessagesResponse>({ method: 'GET', path: `v2/gamegen/sessions/${id}/messages` }),

  sendMessage: (id: string, text: string, supportsAskUser = true) =>
    request<T.SendMessageResponse>({
      method: 'POST',
      path: `v2/gamegen/sessions/${id}/messages`,
      body: { text, supportsAskUser },
    }),

  publish: (id: string, title: string) =>
    request<T.PublishResponse>({ method: 'POST', path: `v2/gamegen/sessions/${id}/publish`, body: { title } }),

  revert: (id: string, messageId: string) =>
    request<unknown>({ method: 'POST', path: `v2/gamegen/sessions/${id}/revert`, body: { messageId } }),

  regenerateThumbnail: (id: string, title: string, description: string) =>
    request<{ code?: string | null; thumbnailRegensLeft?: number | null }>({
      method: 'POST',
      path: `v2/gamegen/sessions/${id}/thumbnail/regenerate`,
      body: { title, description },
    }),

  inFlight: () => request<T.InFlight>({ method: 'GET', path: 'v2/gamegen/in-flight' }),

  promptBreakdown: (input: string) =>
    request<T.PromptBreakdown>({ method: 'POST', path: 'v2/gamegen/prompt-breakdown', body: { input } }),

  credits: () => request<T.Credits>({ method: 'GET', path: 'v2/gamegen/credits' }),
};

export const misc = {
  feedback: (message: string) =>
    request<unknown>({ method: 'POST', path: 'v2/feedback', body: { message } }),
  invite: (code: string) => request<unknown>({ method: 'GET', path: `public/invite/${code}` }),
};
