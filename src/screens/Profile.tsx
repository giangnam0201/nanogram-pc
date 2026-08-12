import { useEffect, useState } from 'preact/hooks';
import { games as gamesApi, profile as api } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { loadMe, me, navigate, switchTab, toast } from '../lib/store';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  FullSpinner,
  Sheet,
  formatCount,
} from '../components/common';
import { GameCard, type CardGame } from '../components/GameCard';
import { GamePlayer } from '../components/GamePlayer';
import { Icon } from '../components/Icon';
import type { MeGame } from '../lib/types';

type Tab = 'mine' | 'saved';

export function ProfileScreen() {
  const user = me.value;
  const [tab, setTab] = useState<Tab>('mine');
  const [games, setGames] = useState<MeGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<CardGame | null>(null);
  const [menuFor, setMenuFor] = useState<MeGame | null>(null);
  const [renaming, setRenaming] = useState<MeGame | null>(null);
  const [renameText, setRenameText] = useState('');

  async function load() {
    setGames(null);
    try {
      const res = tab === 'mine' ? await api.myGames() : await api.saved();
      setGames(res.games ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('profile_error_load')));
    }
  }

  useEffect(() => {
    void load();
  }, [tab]);

  useEffect(() => {
    if (!user) void loadMe();
  }, []);

  async function remove(game: MeGame) {
    try {
      await gamesApi.remove(game.id);
      setGames((prev) => prev?.filter((g) => g.id !== game.id) ?? prev);
      setMenuFor(null);
    } catch (e) {
      toast(errorMessage(e, t('profile_error_delete_game')), 'error');
    }
  }

  async function rename() {
    if (!renaming) return;
    const title = renameText.trim();
    if (!title) return;
    try {
      await gamesApi.rename(renaming.id, title);
      setGames((prev) => prev?.map((g) => (g.id === renaming.id ? { ...g, title } : g)) ?? prev);
      setRenaming(null);
    } catch (e) {
      toast(errorMessage(e, t('profile_error_rename_game')), 'error');
    }
  }

  if (!user) return <FullSpinner />;

  return (
    <div class="screen">
      <div class="screen-head">
        <h1 class="screen-title">@{user.username}</h1>
        <span class="spacer" />
        <button
          class="icon-btn"
          onClick={() => navigate({ name: 'notifications' })}
          aria-label={t('profile_notifications')}
        >
          <Icon name="ic_bell" size={19} />
        </button>
        <button
          class="icon-btn"
          onClick={() => navigate({ name: 'settings' })}
          aria-label={t('profile_settings')}
        >
          <Icon name="ic_cog" size={19} />
        </button>
      </div>

      <div class="screen-pad">
        <div class="profile-head">
          <Avatar url={user.avatarUrl} name={user.username} size={92} />
          <div>
            <div class="profile-stats">
              <div>
                <div class="stat-num">{formatCount(user.stats?.games ?? user.games)}</div>
                <div class="stat-label">Games</div>
              </div>
              <div>
                <div class="stat-num">{formatCount(user.followersCount)}</div>
                <div class="stat-label">Followers</div>
              </div>
              <div>
                <div class="stat-num">{formatCount(user.followingCount)}</div>
                <div class="stat-label">Following</div>
              </div>
              <div>
                <div class="stat-num">{formatCount(user.stats?.likes)}</div>
                <div class="stat-label">Likes</div>
              </div>
            </div>
            {user.bio && <p class="bio">{user.bio}</p>}
          </div>
        </div>

        <div class="tabs">
          <button class={`tab${tab === 'mine' ? ' is-active' : ''}`} onClick={() => setTab('mine')}>
            {t('profile_tab_my_games')}
          </button>
          <button class={`tab${tab === 'saved' ? ' is-active' : ''}`} onClick={() => setTab('saved')}>
            {t('profile_tab_saved')}
          </button>
        </div>

        {error ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : games === null ? (
          <FullSpinner />
        ) : games.length === 0 ? (
          <div class="stack" style={{ justifyItems: 'center' }}>
            <EmptyState
              text={tab === 'mine' ? t('profile_empty_my_games') : t('profile_empty_saved')}
              icon="ic_gameboy"
            />
            {tab === 'mine' && (
              <Button onClick={() => switchTab('create')}>
                {t('profile_create_game')}
              </Button>
            )}
          </div>
        ) : (
          <div class="grid" style={{ marginTop: 16 }}>
            {games.map((g) => (
              <div key={g.id} style={{ position: 'relative' }}>
                <GameCard
                  game={{
                    id: g.id,
                    title: g.title,
                    thumbnailUrl: g.thumbnailUrl,
                    gameUrl: g.gameUrl,
                    username: g.creator?.username,
                    likes: g.counts?.likes,
                  }}
                  onOpen={setPlaying}
                  badge={
                    g.review?.status === 'pending'
                      ? t('profile_game_status_pending')
                      : g.review?.status === 'rejected'
                        ? t('profile_game_status_rejected')
                        : null
                  }
                />
                {tab === 'mine' && (
                  <button
                    class="icon-btn"
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.5)' }}
                    aria-label={t('profile_game_menu')}
                    onClick={() => setMenuFor(g)}
                  >
                    <Icon name="ic_more_vert" size={16} />
                  </button>
                )}
              </div>
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

      {menuFor && (
        <Sheet title={menuFor.title ?? ''} onClose={() => setMenuFor(null)}>
          <div class="stack">
            <Button
              full
              variant="outline"
              onClick={() => {
                setRenameText(menuFor.title ?? '');
                setRenaming(menuFor);
                setMenuFor(null);
              }}
            >
              <Icon name="ic_pen" size={16} />
              {t('profile_rename_game')}
            </Button>
            <Button full variant="danger" onClick={() => void remove(menuFor)}>
              <Icon name="ic_streamline_trash" size={16} />
              {t('profile_delete_game')}
            </Button>
            <p class="muted small">{t('profile_delete_game_body')}</p>
          </div>
        </Sheet>
      )}

      {renaming && (
        <Sheet title={t('profile_rename_game_title')} onClose={() => setRenaming(null)}>
          <div class="stack">
            <input
              class="input"
              placeholder={t('profile_rename_game_hint')}
              value={renameText}
              maxLength={80}
              onInput={(e) => setRenameText((e.target as HTMLInputElement).value)}
            />
            <Button full onClick={() => void rename()} disabled={!renameText.trim()}>
              {t('profile_rename_game')}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
