import { useEffect, useState } from 'preact/hooks';
import { discover } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back } from '../lib/store';
import { EmptyState, ErrorState, FullSpinner, formatCount } from '../components/common';
import { GamePlayer } from '../components/GamePlayer';
import { Icon } from '../components/Icon';
import type { LeaderboardItem, LeaderboardResponse } from '../lib/types';

type Period = 'daily' | 'weekly' | 'alltime';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'discover_period_today' },
  { key: 'weekly', label: 'discover_period_this_week' },
  { key: 'alltime', label: 'discover_period_all_time' },
];

export function LeaderboardScreen() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [period, setPeriod] = useState<Period>('daily');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<LeaderboardItem | null>(null);

  async function load() {
    try {
      setData(await discover.leaderboard());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('discover_error_leaderboard')));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = data?.[period] ?? [];

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">{t('discover_most_popular_games')}</h1>
      </div>

      <div class="screen-pad">
        <div class="chips">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              class={`chip${period === p.key ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {t(p.label)}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : !data ? (
          <FullSpinner />
        ) : rows.length === 0 ? (
          <EmptyState text={t('discover_empty_leaderboard')} icon="ic_trending_up" />
        ) : (
          <div class="list" style={{ marginTop: 16 }}>
            {rows.map((game, index) => (
              <button key={game.id} class="row" onClick={() => setPlaying(game)}>
                <strong style={{ width: 28, textAlign: 'center', color: 'var(--brand)' }}>
                  {index + 1}
                </strong>
                {game.thumbnailUrl ? (
                  <img src={game.thumbnailUrl} alt="" class="row-thumb" loading="lazy" />
                ) : (
                  <div class="row-thumb" />
                )}
                <div class="row-main">
                  <div class="row-title">{game.title}</div>
                  <div class="row-sub">
                    {t('discover_list_row_subtitle', game.username, formatCount(game.likes))}
                  </div>
                </div>
              </button>
            ))}
          </div>
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
