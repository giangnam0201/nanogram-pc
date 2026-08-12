import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { feed as feedApi, games } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { cdnUrl } from '../lib/cdn';
import { me, navigate, toast } from '../lib/store';
import { Avatar, ErrorState, FullSpinner, formatCount } from '../components/common';
import { Icon } from '../components/Icon';
import { GAME_SANDBOX } from '../components/GamePlayer';
import { ShareSheet } from '../components/ShareSheet';
import { CommentsSheet } from '../components/Comments';
import type { GameFeedItem } from '../lib/types';

/* The Android client keeps a small pool of WebViews and only ever runs the
   visible game. We do the same: exactly one frame is mounted (the active
   slide), the neighbour is prefetched as a thumbnail only. That keeps memory
   flat no matter how far you scroll. */

const PAGE = 10;
const PREFETCH_AT = 3; // load more when this many slides remain

export function HomeScreen() {
  const [items, setItems] = useState<GameFeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<GameFeedItem | null>(null);
  const [commentsFor, setCommentsFor] = useState<GameFeedItem | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async (append = false) => {
    try {
      const res = await feedApi.list(PAGE, me.value?.id);
      const fresh = res.games ?? [];
      setItems((prev) => {
        if (!append || !prev) return fresh;
        // The feed endpoint can repeat games; keep the rail stable.
        const known = new Set(prev.map((g) => g.id));
        return [...prev, ...fresh.filter((g) => !known.has(g.id))];
      });
      setError(res.error ?? null);
    } catch (e) {
      setError(errorMessage(e, t('feed_load_failed', '')));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Track which slide is centred. */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !items?.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            setActive(index);
          }
        }
      },
      { root: el, threshold: [0.6] },
    );

    el.querySelectorAll('.feed-slide').forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [items?.length]);

  /* Report the view and refresh counters, like the Android feed does. */
  useEffect(() => {
    const game = items?.[active];
    if (!game || seen.current.has(game.id)) return;
    seen.current.add(game.id);

    void feedApi
      .stats(game.id, me.value?.id)
      .then((stats) => {
        setItems(
          (prev) =>
            prev?.map((g) =>
              g.id === game.id
                ? {
                    ...g,
                    likes: stats.likes ?? g.likes,
                    shares: stats.shares ?? g.shares,
                    comments: stats.comments ?? g.comments,
                    saves: stats.saves ?? g.saves,
                    isLiked: stats.isLiked ?? g.isLiked,
                    isShared: stats.isShared ?? g.isShared,
                    isSaved: stats.isSaved ?? g.isSaved,
                  }
                : g,
            ) ?? prev,
        );
      })
      .catch(() => {
        /* view reporting is fire-and-forget */
      });
  }, [active, items]);

  /* Endless feed. */
  useEffect(() => {
    if (!items || loadingMore.current) return;
    if (items.length - active > PREFETCH_AT) return;
    loadingMore.current = true;
    void load(true).finally(() => {
      loadingMore.current = false;
    });
  }, [active, items, load]);

  /* Keyboard paging — desktop expects arrow keys to work. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shareFor || commentsFor) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const next = active + (e.key === 'ArrowDown' ? 1 : -1);
      const slide = scroller.current?.querySelector(`[data-index="${next}"]`);
      slide?.scrollIntoView({ behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, shareFor, commentsFor]);

  function patch(id: string, changes: Partial<GameFeedItem>) {
    setItems((prev) => prev?.map((g) => (g.id === id ? { ...g, ...changes } : g)) ?? prev);
  }

  async function toggleLike(game: GameFeedItem) {
    const liked = !!game.isLiked;
    patch(game.id, { isLiked: !liked, likes: (game.likes ?? 0) + (liked ? -1 : 1) });
    try {
      const res = liked ? await games.unlike(game.id) : await games.like(game.id);
      patch(game.id, { isLiked: res.isLiked ?? !liked, likes: res.likesCount ?? game.likes });
    } catch (e) {
      patch(game.id, { isLiked: liked, likes: game.likes });
      toast(errorMessage(e), 'error');
    }
  }

  async function toggleSave(game: GameFeedItem) {
    const saved = !!game.isSaved;
    patch(game.id, { isSaved: !saved, saves: (game.saves ?? 0) + (saved ? -1 : 1) });
    try {
      const res = saved ? await games.unsave(game.id) : await games.save(game.id);
      patch(game.id, { isSaved: res.isSaved ?? !saved, saves: res.savesCount ?? game.saves });
      toast(saved ? t('discover_game_unsaved') : t('discover_game_saved'));
    } catch (e) {
      patch(game.id, { isSaved: saved, saves: game.saves });
      toast(errorMessage(e, t('discover_error_save')), 'error');
    }
  }

  if (items === null && !error) return <FullSpinner />;
  if (error && !items?.length) return <ErrorState text={error} onRetry={() => void load()} />;
  if (!items?.length) return <ErrorState text={t('feed_no_games')} onRetry={() => void load()} />;

  return (
    <>
      <div class="feed" ref={scroller}>
        {items.map((game, index) => {
          const isActive = index === active;
          const isPlaying = playing === game.id && isActive;
          return (
            <section class="feed-slide" data-index={index} key={`${game.id}-${index}`}>
              <div class="feed-stage">
                {isPlaying ? (
                  <iframe
                    src={cdnUrl(game.gameUrl)}
                    title={game.title}
                    sandbox={GAME_SANDBOX}
                    allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
                  />
                ) : (
                  <button
                    class="feed-cover"
                    onClick={() => setPlaying(game.id)}
                    aria-label={t('discover_quick_play')}
                  >
                    <div class="feed-play">
                      <Icon name="ic_quick_play" size={30} />
                    </div>
                  </button>
                )}

                <div class="feed-meta">
                  <button
                    class="feed-author"
                    onClick={() =>
                      game.creatorId && navigate({ name: 'user', userId: game.creatorId })
                    }
                  >
                    <Avatar url={game.avatarUrl} name={game.username} size={34} />
                    <span class="feed-username">@{game.username}</span>
                  </button>
                  <p class="feed-game-title">{game.title}</p>
                </div>

                <div class="feed-rail">
                  <button
                    class={`rail-btn${game.isLiked ? ' is-on' : ''}`}
                    onClick={() => void toggleLike(game)}
                    aria-label={t('feed_like')}
                  >
                    <Icon
                      name={game.isLiked ? 'ic_streamline_like_filled' : 'ic_streamline_like'}
                      size={26}
                    />
                    <span class="rail-count">{formatCount(game.likes)}</span>
                  </button>

                  <button
                    class="rail-btn"
                    onClick={() => setCommentsFor(game)}
                    aria-label={t('feed_comment')}
                  >
                    <Icon name="ic_streamline_comment" size={26} />
                    <span class="rail-count">{formatCount(game.comments)}</span>
                  </button>

                  <button
                    class={`rail-btn${game.isSaved ? ' is-on' : ''}`}
                    onClick={() => void toggleSave(game)}
                    aria-label={t('feed_save')}
                  >
                    <Icon
                      name={game.isSaved ? 'ic_streamline_save_filled' : 'ic_streamline_save'}
                      size={26}
                    />
                    <span class="rail-count">{formatCount(game.saves)}</span>
                  </button>

                  <button
                    class="rail-btn"
                    onClick={() => setShareFor(game)}
                    aria-label={t('feed_share')}
                  >
                    <Icon name="ic_streamline_share" size={26} />
                    <span class="rail-count">{formatCount(game.shares)}</span>
                  </button>

                  <button
                    class="rail-btn"
                    onClick={() => navigate({ name: 'game', gameId: game.id })}
                    aria-label={t('feed_remix')}
                  >
                    <Icon name="ic_streamline_remix" size={26} />
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {shareFor && (
        <ShareSheet
          gameId={shareFor.id}
          title={shareFor.title}
          author={shareFor.username}
          onClose={() => setShareFor(null)}
          onShared={(count) => count != null && patch(shareFor.id, { shares: count })}
        />
      )}

      {commentsFor && (
        <CommentsSheet
          gameId={commentsFor.id}
          locked={!!me.value?.parentalControls?.commentsLocked}
          onClose={() => setCommentsFor(null)}
          onCountChange={(n) => patch(commentsFor.id, { comments: n })}
        />
      )}
    </>
  );
}
