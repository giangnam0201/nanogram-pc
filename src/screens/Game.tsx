import { useEffect, useState } from 'preact/hooks';
import { games } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back, me, navigate, toast } from '../lib/store';
import { Avatar, Button, ErrorState, FullSpinner, formatCount } from '../components/common';
import { Icon } from '../components/Icon';
import { GameFrame, useGameUrl } from '../components/GamePlayer';
import { ShareSheet } from '../components/ShareSheet';
import { CommentsSheet } from '../components/Comments';
import type { GameV2 } from '../lib/types';

export function GameScreen({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<GameV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const url = useGameUrl(gameId, game?.gameUrl);

  async function load() {
    try {
      setGame(await games.get(gameId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('api_error_game_not_found')));
    }
  }

  useEffect(() => {
    void load();
  }, [gameId]);

  function patch(changes: Partial<GameV2>) {
    setGame((prev) => (prev ? { ...prev, ...changes } : prev));
  }

  async function toggleLike() {
    if (!game) return;
    const liked = !!game.isLiked;
    patch({ isLiked: !liked });
    try {
      const res = liked ? await games.unlike(gameId) : await games.like(gameId);
      patch({
        isLiked: res.isLiked ?? !liked,
        counts: { ...game.counts, likes: res.likesCount ?? game.counts?.likes },
      });
    } catch (e) {
      patch({ isLiked: liked });
      toast(errorMessage(e), 'error');
    }
  }

  async function toggleSave() {
    if (!game) return;
    const saved = !!game.isSaved;
    patch({ isSaved: !saved });
    try {
      const res = saved ? await games.unsave(gameId) : await games.save(gameId);
      patch({
        isSaved: res.isSaved ?? !saved,
        counts: { ...game.counts, saves: res.savesCount ?? game.counts?.saves },
      });
      toast(saved ? t('discover_game_unsaved') : t('discover_game_saved'));
    } catch (e) {
      patch({ isSaved: saved });
      toast(errorMessage(e), 'error');
    }
  }

  if (error) return <ErrorState text={error} onRetry={() => void load()} />;
  if (!game) return <FullSpinner />;

  return (
    <div class="screen" style={{ overflow: 'hidden', height: '100%' }}>
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title truncate">{game.title ?? 'Game'}</h1>
        <span class="spacer" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          height: 'calc(100% - 66px)',
        }}
      >
        <div style={{ background: '#000', display: 'grid', placeItems: 'center', position: 'relative' }}>
          <div
            style={{
              position: 'relative',
              height: '100%',
              aspectRatio: '9 / 16',
              maxWidth: '100%',
            }}
          >
            <GameFrame url={url} title={game.title} />
          </div>
        </div>

        <aside class="screen-pad" style={{ overflowY: 'auto', borderLeft: '1px solid var(--line)' }}>
          <button
            class="row"
            onClick={() => game.creator?.id && navigate({ name: 'user', userId: game.creator.id })}
          >
            <Avatar url={game.creator?.avatarUrl} name={game.creator?.username} size={44} />
            <div class="row-main">
              <div class="row-title">@{game.creator?.username}</div>
              <div class="row-sub">{game.ageRating ?? ''}</div>
            </div>
          </button>

          <div class="stack" style={{ marginTop: 16 }}>
            <Button
              full
              variant={game.isLiked ? 'primary' : 'outline'}
              onClick={() => void toggleLike()}
            >
              <Icon
                name={game.isLiked ? 'ic_streamline_like_filled' : 'ic_streamline_like'}
                size={17}
              />
              {formatCount(game.counts?.likes)} {t('feed_like')}
            </Button>

            <Button full variant="outline" onClick={() => setCommentsOpen(true)}>
              <Icon name="ic_streamline_comment" size={17} />
              {formatCount(game.counts?.comments)} {t('feed_comment')}
            </Button>

            <Button
              full
              variant={game.isSaved ? 'primary' : 'outline'}
              onClick={() => void toggleSave()}
            >
              <Icon
                name={game.isSaved ? 'ic_streamline_save_filled' : 'ic_streamline_save'}
                size={17}
              />
              {formatCount(game.counts?.saves)} {t('feed_save')}
            </Button>

            <Button full variant="outline" onClick={() => setShareOpen(true)}>
              <Icon name="ic_streamline_share" size={17} />
              {formatCount(game.counts?.shares)} {t('feed_share')}
            </Button>
          </div>

          {game.genres && game.genres.length > 0 && (
            <>
              <h2 class="section-title">Genres</h2>
              <div class="chips">
                {game.genres.map((g) => (
                  <span key={g} class="chip">
                    {g}
                  </span>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      {shareOpen && (
        <ShareSheet
          gameId={gameId}
          title={game.title}
          author={game.creator?.username}
          onClose={() => setShareOpen(false)}
          onShared={(count) =>
            count != null && patch({ counts: { ...game.counts, shares: count } })
          }
        />
      )}

      {commentsOpen && (
        <CommentsSheet
          gameId={gameId}
          locked={!!me.value?.parentalControls?.commentsLocked}
          onClose={() => setCommentsOpen(false)}
          onCountChange={(n) => patch({ counts: { ...game.counts, comments: n } })}
        />
      )}
    </div>
  );
}
