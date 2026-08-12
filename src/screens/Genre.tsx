import { useEffect, useState } from 'preact/hooks';
import { discover } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back } from '../lib/store';
import { EmptyState, ErrorState, FullSpinner, Button } from '../components/common';
import { GameCard, type CardGame } from '../components/GameCard';
import { GamePlayer } from '../components/GamePlayer';
import { Icon } from '../components/Icon';
import type { DiscoverGame } from '../lib/types';

export function GenreScreen({ genreId, title }: { genreId: string; title: string }) {
  const [games, setGames] = useState<DiscoverGame[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<CardGame | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(next?: string) {
    if (next) setLoadingMore(true);
    try {
      const res = await discover.genreGames(genreId, next);
      setGames((prev) => (next && prev ? [...prev, ...(res.games ?? [])] : res.games ?? []));
      setCursor(res.nextCursor ?? null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('discover_list_failed')));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load();
  }, [genreId]);

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">{title}</h1>
      </div>

      <div class="screen-pad">
        {error && !games ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : games === null ? (
          <FullSpinner />
        ) : games.length === 0 ? (
          <EmptyState text={t('discover_list_empty')} icon="ic_gameboy" />
        ) : (
          <>
            <div class="grid">
              {games.map((g) => (
                <GameCard
                  key={g.id}
                  game={{
                    id: g.id,
                    title: g.title,
                    thumbnailUrl: g.thumbnailUrl,
                    gameUrl: g.gameUrl,
                    username: g.creator?.username,
                    likes: g.counts?.likes,
                  }}
                  onOpen={setPlaying}
                />
              ))}
            </div>
            {cursor && (
              <div style={{ display: 'grid', placeItems: 'center', marginTop: 24 }}>
                <Button variant="outline" loading={loadingMore} onClick={() => void load(cursor)}>
                  {t('discover_see_all')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {playing && (
        <GamePlayer
          gameId={playing.id}
          title={playing.title}
          gameUrl={playing.gameUrl}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
