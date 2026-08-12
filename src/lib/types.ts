/* Types mirror the Nanogram DTOs one-for-one (see docs/api-dto-schema.json,
   extracted from the Android build). Field names and optionality match the
   server contract exactly — do not "tidy" them. */

export interface Nanotag {
  source?: string | null;
  colorPreset?: string | null;
  chaosPercentage?: number | null;
}

export interface Counts {
  likes?: number | null;
  shares?: number | null;
  comments?: number | null;
  saves?: number | null;
}

export interface Creator {
  id?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  nanotag?: Nanotag | null;
  isFollowing?: boolean | null;
}

/* ---------------------------------------------------------------- feed --- */

export interface GameFeedItem {
  id: string;
  title: string;
  creatorId?: string | null;
  username: string;
  avatarUrl?: string | null;
  gameUrl?: string | null;
  likes?: number | null;
  shares?: number | null;
  comments?: number | null;
  saves?: number | null;
  ageRating?: string | null;
  isLiked?: boolean | null;
  isShared?: boolean | null;
  isSaved?: boolean | null;
}

export interface FeedResponse {
  games?: GameFeedItem[] | null;
  error?: string | null;
}

export interface GameStats {
  likes?: number | null;
  shares?: number | null;
  comments?: number | null;
  saves?: number | null;
  isLiked?: boolean | null;
  isShared?: boolean | null;
  isSaved?: boolean | null;
}

export interface GameV2 {
  id: string;
  title?: string | null;
  gameUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string | null;
  counts?: Counts | null;
  ageRating?: string | null;
  genres?: string[] | null;
  creator?: Creator | null;
  review?: { status?: string | null; reason?: string | null } | null;
  isLiked?: boolean | null;
  isShared?: boolean | null;
  isSaved?: boolean | null;
}

export interface LikeResponse {
  isLiked?: boolean | null;
  likesCount?: number | null;
}
export interface SaveResponse {
  isSaved?: boolean | null;
  savesCount?: number | null;
}
export interface ShareResponse {
  isShared?: boolean | null;
  sharesCount?: number | null;
}

/* ------------------------------------------------------------ discover --- */

export interface DiscoverGame {
  id: string;
  title?: string | null;
  gameUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string | null;
  ageRating?: string | null;
  genres?: string[] | null;
  counts?: Counts | null;
  creator?: Creator | null;
  isLiked?: boolean | null;
  isShared?: boolean | null;
  isSaved?: boolean | null;
  remixCount?: number | null;
}

export interface DiscoverGenre {
  id: string;
  title?: string | null;
  description?: string | null;
}

export interface DiscoverCreator {
  id: string;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  gamesCount?: number | null;
  nanotag?: Nanotag | null;
}

export interface DiscoverSection {
  key: string;
  title?: string | null;
  games?: DiscoverGame[] | null;
  genres?: DiscoverGenre[] | null;
  creators?: DiscoverCreator[] | null;
}

export interface DiscoverResponse {
  gamesCreatedThisWeek?: number | null;
  sections?: DiscoverSection[] | null;
}

export interface LeaderboardItem {
  id: string;
  title: string;
  creatorId?: string | null;
  username: string;
  avatarUrl?: string | null;
  gameUrl?: string | null;
  thumbnailUrl?: string | null;
  likes?: number | null;
  shares?: number | null;
  comments?: number | null;
  saves?: number | null;
  genres?: string[] | null;
  nanotag?: Nanotag | null;
  isLiked?: boolean | null;
  isShared?: boolean | null;
  isSaved?: boolean | null;
}

export interface LeaderboardResponse {
  daily?: LeaderboardItem[] | null;
  weekly?: LeaderboardItem[] | null;
  alltime?: LeaderboardItem[] | null;
}

export interface SearchGame {
  id: string;
  title?: string | null;
  gameUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string | null;
  counts?: Counts | null;
  ageRating?: string | null;
  genres?: string[] | null;
  creator?: Creator | null;
  isSaved?: boolean | null;
  viewer?: { isLiked?: boolean | null; isShared?: boolean | null; isSaved?: boolean | null } | null;
}

export interface SearchUser {
  id: string;
  username?: string | null;
  avatarUrl?: string | null;
  followersCount?: number | null;
  gamesCount?: number | null;
  isFollowing?: boolean | null;
  nanotag?: Nanotag | null;
}

export interface GameSearchResponse {
  games?: SearchGame[] | null;
  nextCursor?: string | null;
}
export interface UserSearchResponse {
  users?: SearchUser[] | null;
  nextCursor?: string | null;
}
export interface GenreGamesResponse {
  games?: DiscoverGame[] | null;
  nextCursor?: string | null;
}
export interface Genre {
  id: string;
  title: string;
}

/* ------------------------------------------------------------- profile --- */

export interface MeStats {
  games?: number | null;
  likes?: number | null;
  remixes?: number | null;
  shares?: number | null;
}

export interface Onboarding {
  completed?: boolean | null;
  requiredSteps?: string[] | null;
  optionalSteps?: string[] | null;
}

export interface ParentalControls {
  enabled?: boolean | null;
  commentsLocked?: boolean | null;
  chatsLocked?: boolean | null;
  maxContentRating?: string | null;
}

export interface Me {
  id: string;
  username?: string | null;
  email?: string | null;
  pendingEmail?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  dateOfBirth?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  games?: number | null;
  stats?: MeStats | null;
  chatUnreadCount?: number | null;
  connectedAuths?: string[] | null;
  referralCode?: string | null;
  onboarding?: Onboarding | null;
  nanotag?: Nanotag | null;
  ageRange?: { lower?: number | null; upper?: number | null } | null;
  parentalControls?: ParentalControls | null;
}

export interface MeGame {
  id: string;
  title?: string | null;
  gameUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string | null;
  counts?: Counts | null;
  ageRating?: string | null;
  creator?: Creator | null;
  review?: { status?: string | null; reason?: string | null } | null;
  isLiked?: boolean | null;
  isShared?: boolean | null;
  isSaved?: boolean | null;
}

export interface MeGamesResponse {
  games?: MeGame[] | null;
  nextCursor?: string | null;
}

export interface UserProfile {
  user?: { id?: string | null; username?: string | null; avatarUrl?: string | null; nanotag?: Nanotag | null } | null;
  bio?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  stats?: MeStats | null;
  isFollowing?: boolean | null;
}

export interface FollowResponse {
  isFollowing?: boolean | null;
  followersCount?: number | null;
}

export interface FollowUser {
  id: string;
  username?: string | null;
  avatarUrl?: string | null;
  isFollowing?: boolean | null;
  nanotag?: Nanotag | null;
}

export interface FollowListResponse {
  users?: FollowUser[] | null;
  nextCursor?: string | null;
}

/* ------------------------------------------------------------ comments --- */

export interface Comment {
  id: string;
  author?: Creator | null;
  body?: string | null;
  giphyId?: string | null;
  giphyUrl?: string | null;
  likesCount?: number | null;
  isLiked?: boolean | null;
  createdAt?: string | null;
  parentId?: string | null;
  replies?: Comment[] | null;
  repliesCount?: number | null;
  repliesNextCursor?: string | null;
}

export interface CommentListResponse {
  comments?: Comment[] | null;
  total?: number | null;
  nextCursor?: string | null;
}

export interface CreateCommentResponse {
  comment?: Comment | null;
  commentsCount?: number | null;
}

/* ---------------------------------------------------------------- chat --- */

export interface ChatUser {
  id?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  nanotag?: Nanotag | null;
}

export interface ChatGame {
  id: string;
  title?: string | null;
  thumbnailUrl?: string | null;
  creator?: { id?: string | null; username?: string | null } | null;
}

export interface ChatMessage {
  id: string;
  chatId?: string | null;
  senderId?: string | null;
  text?: string | null;
  game?: ChatGame | null;
  gameUnavailable?: boolean | null;
  replyTo?: { id: string; senderId?: string | null; text?: string | null; gameId?: string | null } | null;
  clientNonce?: string | null;
  createdAt?: string | null;
}

export interface Chat {
  id: string;
  kind?: string | null;
  inbox?: string | null;
  otherUser?: ChatUser | null;
  lastMessage?: ChatMessage | null;
  unreadCount?: number | null;
  promotedAt?: string | null;
  lastMessageAt?: string | null;
  createdAt?: string | null;
}

export interface ChatListResponse {
  chats?: Chat[] | null;
  cursor?: string | null;
}
export interface ChatMessagesResponse {
  messages?: ChatMessage[] | null;
  cursor?: string | null;
}

export interface FriendUser {
  id: string;
  username?: string | null;
  avatarUrl?: string | null;
  nanotag?: Nanotag | null;
}
export interface FriendsResponse {
  users?: FriendUser[] | null;
  nextCursor?: string | null;
}

/* ------------------------------------------------------- notifications --- */

export interface NotificationItem {
  id?: string | null;
  eventType?: string | null;
  gameId?: string | null;
  commentId?: string | null;
  actors?: Creator[] | null;
  actorCount?: number | null;
  preview?: string | null;
  game?: { id?: string | null; title?: string | null; thumbnailUrl?: string | null } | null;
  read?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface NotificationsResponse {
  notifications?: NotificationItem[] | null;
  nextCursor?: string | null;
  unreadCount?: number | null;
}

/* ------------------------------------------------------------- gamegen --- */

export interface GameGenStyle {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  dimension?: string | null;
  screenshotUrl?: string | null;
}

export interface SessionSummary {
  id: string;
  styleId?: string | null;
  firstMessage?: string | null;
  messageCount?: number | null;
  hasHtml?: boolean | null;
  updatedAt?: string | null;
  publishedGameId?: string | null;
  publishedGameThumbnailUrl?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
}

export interface SessionsResponse {
  sessions?: SessionSummary[] | null;
  nextCursor?: string | null;
}

export interface GameGenMessage {
  id: string;
  sessionId?: string | null;
  role?: string | null;
  content?: string | null;
  status?: string | null;
  createdAt?: string | null;
  htmlSnapshot?: string | null;
}

export interface MessagesResponse {
  messages?: GameGenMessage[] | null;
  remixHtml?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  thumbnailKind?: string | null;
  thumbnailRegensLeft?: number | null;
}

export interface SendMessageResponse {
  userMessage: GameGenMessage;
  assistantMessage: GameGenMessage;
  firstBuild?: boolean | null;
}

export interface InFlight {
  state?: string | null;
  inFlight?: boolean | null;
  sessionId?: string | null;
  messageId?: string | null;
  styleId?: string | null;
  styleName?: string | null;
  since?: string | null;
  questionText?: string | null;
}

export interface PromptBreakdown {
  values?: { key?: string | null; value?: string | null; suggestion?: string | null }[] | null;
}

export interface Credits {
  usedToday?: number | null;
  allowedToday?: number | null;
  remainingToday?: number | null;
  bankBalance?: number | null;
  resetsAt?: string | null;
  inFlight?: boolean | null;
  shareClicksToday?: number | null;
  shareClicksDailyMax?: number | null;
  tenLikesToday?: number | null;
  tenLikesDailyMax?: number | null;
}

export interface CreateSessionResponse {
  id: string;
  styleId?: string | null;
  createdAt?: string | null;
}

export interface PublishResponse {
  gameId?: string | null;
}

/* ------------------------------------------------------------- session --- */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  userId: string;
  emailVerified?: boolean | null;
  newUser?: boolean | null;
}

export interface ClientConfig {
  discordClientId?: string | null;
  discordRedirectUri?: string | null;
  discordInviteUrl?: string | null;
}

export interface Availability {
  available: boolean;
  code?: string | null;
}

/* ------------------------------------------------------- credits & co --- */

export interface Achievement {
  id?: string | null;
  reward?: number | null;
  repeatability?: string | null;
  progress?: number | null;
  target?: number | null;
  completed?: boolean | null;
}

export interface CreditTransaction {
  id?: string | null;
  delta?: number | null;
  kind?: string | null;
  description?: string | null;
  createdAt?: string | null;
  bucket?: string | null;
}

export interface CreditTransactionsResponse {
  transactions?: CreditTransaction[] | null;
  nextCursor?: number | null;
}

export interface BlockRow {
  user?: { id?: string | null; username?: string | null; avatarUrl?: string | null } | null;
  createdAt?: string | null;
}

export interface NotificationPrefs {
  pushEnabled: boolean;
  likesEnabled: boolean;
  commentsEnabled: boolean;
  savesEnabled: boolean;
  followsEnabled: boolean;
  mentionsEnabled: boolean;
}
