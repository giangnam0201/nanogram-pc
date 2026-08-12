import { useEffect, useState } from 'preact/hooks';
import { chat as chatApi, profile as api } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back, navigate, toast } from '../lib/store';
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
import type { MeGame, UserProfile } from '../lib/types';

export function UserScreen({ userId }: { userId: string }) {
  const [data, setData] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<MeGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<CardGame | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [p, g] = await Promise.all([api.user(userId), api.userGames(userId)]);
      setData(p);
      setGames(g.games ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('profile_error_load')));
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);

  async function toggleFollow() {
    if (!data) return;
    const following = !!data.isFollowing;
    setBusy(true);
    setData({ ...data, isFollowing: !following });
    try {
      const res = following ? await api.unfollow(userId) : await api.follow(userId);
      setData((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: res.isFollowing ?? !following,
              followersCount: res.followersCount ?? prev.followersCount,
            }
          : prev,
      );
    } catch (e) {
      setData((prev) => (prev ? { ...prev, isFollowing: following } : prev));
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function message() {
    try {
      const chat = await chatApi.create(userId);
      navigate({ name: 'chat', chatId: chat.id });
    } catch (e) {
      toast(errorMessage(e, t('chat_error_create')), 'error');
    }
  }

  async function block() {
    try {
      await api.block(userId);
      setMenuOpen(false);
      toast(t('profile_block_dialog_confirm'));
      back();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function report() {
    try {
      await api.reportUser(userId, 'inappropriate');
      setMenuOpen(false);
      toast(t('feedback_thanks'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (error) return <ErrorState text={error} onRetry={() => void load()} />;
  if (!data) return <FullSpinner />;

  const user = data.user;

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">@{user?.username}</h1>
        <span class="spacer" />
        <button class="icon-btn" onClick={() => setMenuOpen(true)} aria-label={t('profile_more_options')}>
          <Icon name="ic_more_vert" size={19} />
        </button>
      </div>

      <div class="screen-pad">
        <div class="profile-head">
          <Avatar url={user?.avatarUrl} name={user?.username} size={92} />
          <div>
            <div class="profile-stats">
              <div>
                <div class="stat-num">{formatCount(data.stats?.games)}</div>
                <div class="stat-label">Games</div>
              </div>
              <div>
                <div class="stat-num">{formatCount(data.followersCount)}</div>
                <div class="stat-label">Followers</div>
              </div>
              <div>
                <div class="stat-num">{formatCount(data.followingCount)}</div>
                <div class="stat-label">Following</div>
              </div>
            </div>
            {data.bio && <p class="bio">{data.bio}</p>}
          </div>
        </div>

        <div class="hstack">
          <Button
            variant={data.isFollowing ? 'outline' : 'primary'}
            onClick={() => void toggleFollow()}
            disabled={busy}
          >
            {data.isFollowing ? t('profile_following') : t('profile_follow')}
          </Button>
          <Button variant="outline" onClick={() => void message()}>
            {t('profile_message')}
          </Button>
        </div>

        {games === null ? (
          <FullSpinner />
        ) : games.length === 0 ? (
          <EmptyState text={t('profile_empty_user_games')} icon="ic_gameboy" />
        ) : (
          <div class="grid" style={{ marginTop: 20 }}>
            {games.map((g) => (
              <GameCard
                key={g.id}
                game={{
                  id: g.id,
                  title: g.title,
                  thumbnailUrl: g.thumbnailUrl,
                  gameUrl: g.gameUrl,
                  username: user?.username,
                  likes: g.counts?.likes,
                }}
                onOpen={setPlaying}
              />
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

      {menuOpen && (
        <Sheet title={t('profile_more_options')} onClose={() => setMenuOpen(false)}>
          <div class="stack">
            <Button full variant="outline" onClick={() => void report()}>
              <Icon name="ic_report_flag" size={16} />
              {t('profile_report_user')}
            </Button>
            <Button full variant="danger" onClick={() => void block()}>
              <Icon name="ic_person_2_slash" size={16} />
              {t('profile_block_dialog_title')}
            </Button>
            <p class="muted small">{t('profile_block_dialog_message')}</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
