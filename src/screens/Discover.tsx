import { useEffect, useState } from 'preact/hooks';
import { discover } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { navigate } from '../lib/store';
import { Avatar, ErrorState, FullSpinner, formatCount } from '../components/common';
import { GameCard, type CardGame } from '../components/GameCard';
import { GamePlayer } from '../components/GamePlayer';
import { Icon } from '../components/Icon';
import type { DiscoverResponse, SearchGame, SearchUser } from '../lib/types';

type SearchTab = 'games' | 'users';

export function DiscoverScreen() {
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('games');
  const [gameHits, setGameHits] = useState<SearchGame[] | null>(null);
  const [userHits, setUserHits] = useState<SearchUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [playing, setPlaying] = useState<CardGame | null>(null);

  async function load() {
    try {
      setData(await discover.sections());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('discover_list_failed')));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /* Debounced search — the Android search field behaves the same way. */
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setGameHits(null);
      setUserHits(null);
      return;
    }
    let alive = true;
    setSearching(true);
    const id = window.setTimeout(async () => {
      try {
        if (tab === 'games') {
          const res = await discover.searchGames(q);
          if (alive) setGameHits(res.games ?? []);
        } else {
          const res = await discover.searchUsers(q);
          if (alive) setUserHits(res.users ?? []);
        }
      } catch {
        if (alive) {
          setGameHits([]);
          setUserHits([]);
        }
      } finally {
        if (alive) setSearching(false);
      }
    }, 280);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [query, tab]);

  const isSearching = query.trim().length > 0;

  return (
    <div class="screen">
      <div class="screen-head">
        <Icon name="ic_streamline_magnifier" size={18} />
        <input
          class="input"
          style={{ background: 'var(--surface-2)' }}
          placeholder={t('discover_search_placeholder')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        {isSearching && (
          <button class="icon-btn" onClick={() => setQuery('')} aria-label={t('discover_clear_search')}>
            <Icon name="ic_pill_close" size={16} />
          </button>
        )}
      </div>

      <div class="screen-pad">
        {isSearching ? (
          <>
            <div class="tabs">
              <button
                class={`tab${tab === 'games' ? ' is-active' : ''}`}
                onClick={() => setTab('games')}
              >
                {t('discover_search_tab_games')}
              </button>
              <button
                class={`tab${tab === 'users' ? ' is-active' : ''}`}
                onClick={() => setTab('users')}
              >
                {t('discover_search_tab_users')}
              </button>
            </div>

            {searching && <FullSpinner />}

            {!searching && tab === 'games' && (
              <div class="grid" style={{ marginTop: 16 }}>
                {gameHits?.length === 0 && (
                  <p class="muted">{t('discover_search_no_results', query)}</p>
                )}
                {gameHits?.map((g) => (
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
            )}

            {!searching && tab === 'users' && (
              <div class="list" style={{ marginTop: 8 }}>
                {userHits?.length === 0 && <p class="muted">{t('discover_search_no_users', query)}</p>}
                {userHits?.map((u) => (
                  <button
                    key={u.id}
                    class="row"
                    onClick={() => navigate({ name: 'user', userId: u.id })}
                  >
                    <Avatar url={u.avatarUrl} name={u.username} size={44} />
                    <div class="row-main">
                      <div class="row-title">@{u.username}</div>
                      <div class="row-sub">
                        {formatCount(u.followersCount)} followers · {formatCount(u.gamesCount)} games
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : error && !data ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : !data ? (
          <FullSpinner />
        ) : (
          <>
            {data.gamesCreatedThisWeek != null && (
              <div class="hstack" style={{ marginTop: 4 }}>
                <Icon name="ic_local_fire_department" size={18} />
                <strong>{formatCount(data.gamesCreatedThisWeek)}</strong>
                <span class="muted small">{t('discover_games_made_week')}</span>
                <span class="spacer" />
                <button class="chip" onClick={() => navigate({ name: 'leaderboard' })}>
                  {t('discover_see_all_top_games')}
                </button>
              </div>
            )}

            {data.sections?.map((section) => (
              <section key={section.key}>
                <h2 class="section-title">{section.title ?? section.key}</h2>

                {section.genres && section.genres.length > 0 && (
                  <div class="chips">
                    {section.genres.map((g) => (
                      <button
                        key={g.id}
                        class="chip"
                        onClick={() =>
                          navigate({ name: 'genre', genreId: g.id, title: g.title ?? '' })
                        }
                      >
                        {g.title}
                      </button>
                    ))}
                  </div>
                )}

                {section.creators && section.creators.length > 0 && (
                  <div class="rail">
                    {section.creators.map((c) => (
                      <button
                        key={c.id}
                        class="card"
                        onClick={() => navigate({ name: 'user', userId: c.id })}
                      >
                        <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
                          <Avatar url={c.avatarUrl} name={c.username} size={72} />
                          <div class="card-title">@{c.username}</div>
                          <div class="card-sub">{formatCount(c.followersCount)} followers</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {section.games && section.games.length > 0 && (
                  <div class="rail">
                    {section.games.map((g) => (
                      <GameCard
                        key={g.id}
                        game={{
                          id: g.id,
                          title: g.title,
                          thumbnailUrl: g.thumbnailUrl,
                          gameUrl: g.gameUrl,
                          username: g.creator?.username,
                          likes: g.counts?.likes,
                          remixCount: g.remixCount,
                        }}
                        onOpen={setPlaying}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
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
