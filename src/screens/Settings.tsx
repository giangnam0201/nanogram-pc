import { useEffect, useState } from 'preact/hooks';
import { auth, misc, profile as api } from '../lib/api';
import { errorMessage, ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { isTauri } from '../lib/transport';
import { back, loadMe, me, navigate, signOut, toast } from '../lib/store';
import { Avatar, Button, Sheet, Spinner } from '../components/common';
import { Icon } from '../components/Icon';
import type { BlockRow, Genre, NotificationPrefs } from '../lib/types';

const REPO_URL = 'https://github.com/giangnam0201/nanogram-pc';
const APP_VERSION = '1.1.0';

type Dialog = 'username' | 'feedback' | 'genres' | 'notifications' | 'blocked' | null;

export function SettingsScreen() {
  const user = me.value;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [username, setUsername] = useState(user?.username ?? '');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [discordInvite, setDiscordInvite] = useState<string | null>(null);

  useEffect(() => {
    void auth
      .config()
      .then((c) => setDiscordInvite(c.discordInviteUrl ?? null))
      .catch(() => {});
  }, []);

  async function saveUsername() {
    const value = username.trim();
    if (!value) return;
    setBusy(true);
    try {
      await api.patchMe({ username: value });
      await loadMe();
      setDialog(null);
      toast(t('settings_msg_username_changed'));
    } catch (e) {
      toast(errorMessage(e, t('settings_error_generic')), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback() {
    const text = feedback.trim();
    if (!text) return;
    setBusy(true);
    try {
      await misc.feedback(text);
      setFeedback('');
      setDialog(null);
      toast(t('feedback_thanks'));
    } catch (e) {
      toast(errorMessage(e, t('feedback_error')), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!user?.referralCode) return;
    const link = await ipc.inviteUrl(user.referralCode);
    await navigator.clipboard.writeText(link);
    toast(t('credits_invite_copied'));
  }

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">{t('profile_settings')}</h1>
      </div>

      <div class="screen-pad" style={{ maxWidth: 640 }}>
        <div class="row" style={{ pointerEvents: 'none' }}>
          <Avatar url={user?.avatarUrl} name={user?.username} size={56} />
          <div class="row-main">
            <div class="row-title">@{user?.username}</div>
            <div class="row-sub">{user?.email ?? user?.pendingEmail ?? ''}</div>
          </div>
        </div>

        <h2 class="section-title">Account</h2>
        <div class="list">
          <Row icon="ic_settings_person" title="Username" sub={`@${user?.username ?? ''}`} onClick={() => setDialog('username')} />
          <Row
            icon="ic_settings_envelope"
            title={t('settings_email')}
            sub={user?.email ?? t('settings_email_not_linked')}
          />
          <Row
            icon="ic_settings_calendar"
            title={t('settings_dob')}
            sub={user?.dateOfBirth?.slice(0, 10) ?? t('settings_dob_not_set')}
          />
          <Row
            icon="ic_settings_shield"
            title={t('settings_parental_setup_title')}
            sub={user?.parentalControls?.enabled ? t('settings_parental_setup_subtitle') : 'Off'}
          />
        </div>

        <h2 class="section-title">{t('credits_title')}</h2>
        <div class="list">
          <Row
            icon="ic_credit_card"
            title={t('credits_title')}
            sub={t('credits_available')}
            onClick={() => navigate({ name: 'credits' })}
          />
          {user?.referralCode && (
            <Row
              icon="ic_card_giftcard"
              title={t('credits_invite_title')}
              sub={`${t('credits_invite_link_prefix')}${user.referralCode}`}
              trailing="ic_content_copy"
              onClick={() => void copyInvite()}
            />
          )}
        </div>

        <h2 class="section-title">Preferences</h2>
        <div class="list">
          <Row
            icon="ic_gameboy"
            title={t('settings_genres')}
            sub={t('settings_genres_subtitle')}
            onClick={() => setDialog('genres')}
          />
          <Row
            icon="ic_settings_bell"
            title={t('settings_notifications_title')}
            sub={t('settings_notifications_subtitle')}
            onClick={() => setDialog('notifications')}
          />
          <Row
            icon="ic_person_2_slash"
            title={t('settings_blocked_users')}
            sub={t('settings_blocked_users_subtitle')}
            onClick={() => setDialog('blocked')}
          />
        </div>

        <h2 class="section-title">{t('settings_section_documents')}</h2>
        <div class="list">
          <Row
            icon="ic_generate_insight"
            title={t('feedback_title')}
            onClick={() => setDialog('feedback')}
          />
          {discordInvite && (
            <Row
              icon="ic_settings_discord"
              title={t('create_discord_community')}
              sub={t('discord_invite_join')}
              onClick={() => void ipc.openExternal(discordInvite)}
            />
          )}
          <Row
            icon="ic_settings_lock"
            title={t('welcome_policy_terms')}
            onClick={() => void ipc.openExternal(t('welcome_terms_url'))}
          />
          <Row
            icon="ic_settings_shield"
            title={t('settings_privacy')}
            sub={t('settings_privacy_subtitle')}
            onClick={() => void ipc.openExternal(t('settings_privacy_url'))}
          />
        </div>

        <h2 class="section-title">About</h2>
        <div class="about-card">
          <Icon name="ic_nano_logo" size={44} />
          <strong class="ng-title-sm">Nanogram for {isTauri ? 'Desktop' : 'Web'}</strong>
          <p class="ng-body-sm muted" style={{ maxWidth: '46ch' }}>
            An unofficial client for Nanogram, ported from the Android app. Play, create, remix
            and share instant games.
          </p>
          <span class="ng-caption">Version {APP_VERSION}</span>
          <Button variant="outline" onClick={() => void ipc.openExternal(REPO_URL)}>
            <Icon name="ic_arrow_diagonal" size={15} />
            View on GitHub
          </Button>
          <span class="ng-caption">{REPO_URL.replace('https://', '')}</span>
        </div>

        <div style={{ marginTop: 28 }}>
          <Button full variant="danger" onClick={() => void signOut()}>
            <Icon name="ic_logout" size={16} />
            {t('settings_logout')}
          </Button>
          <p class="ng-caption" style={{ textAlign: 'center', marginTop: 8 }}>
            {t('settings_logout_message')}
          </p>
        </div>
      </div>

      {dialog === 'username' && (
        <Sheet title="Username" onClose={() => setDialog(null)}>
          <div class="stack">
            <input
              class="input"
              value={username}
              maxLength={30}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            />
            <p class="field-hint">{t('create_account_username_error_invalid')}</p>
            <Button full onClick={() => void saveUsername()} loading={busy}>
              {t('genres_save')}
            </Button>
          </div>
        </Sheet>
      )}

      {dialog === 'feedback' && (
        <Sheet title={t('feedback_title')} onClose={() => setDialog(null)}>
          <div class="stack">
            <textarea
              class="textarea"
              placeholder={t('feedback_placeholder')}
              value={feedback}
              maxLength={1000}
              onInput={(e) => setFeedback((e.target as HTMLTextAreaElement).value)}
            />
            <Button full onClick={() => void sendFeedback()} loading={busy} disabled={!feedback.trim()}>
              {t('feedback_submit')}
            </Button>
          </div>
        </Sheet>
      )}

      {dialog === 'genres' && <GenreSheet onClose={() => setDialog(null)} />}
      {dialog === 'notifications' && <NotificationSheet onClose={() => setDialog(null)} />}
      {dialog === 'blocked' && <BlockedSheet onClose={() => setDialog(null)} />}
    </div>
  );
}

function Row({
  icon,
  title,
  sub,
  onClick,
  trailing,
}: {
  icon: string;
  title: string;
  sub?: string;
  onClick?: () => void;
  trailing?: string;
}) {
  const content = (
    <>
      <Icon name={icon} size={19} />
      <div class="row-main">
        <div class="row-title">{title}</div>
        {sub && <div class="row-sub">{sub}</div>}
      </div>
      {trailing && <Icon name={trailing} size={16} />}
    </>
  );
  return onClick ? (
    <button class="row" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div class="row">{content}</div>
  );
}

function GenreSheet({ onClose }: { onClose: () => void }) {
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [all, mine] = await Promise.all([api.genres(), api.myGenres().catch(() => ({}))]);
        setGenres(all);
        setSelected(new Set((mine as { genreIds?: string[] | null }).genreIds ?? []));
      } catch {
        setGenres([]);
        toast(t('genres_error_load'), 'error');
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.setGenres([...selected]);
      toast(t('settings_msg_saved'));
      onClose();
    } catch (e) {
      toast(errorMessage(e, t('genres_error_save')), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('genres_settings_title')} onClose={onClose}>
      <div class="stack">
        <p class="muted small">{t('genres_settings_subtitle')}</p>
        {genres === null ? (
          <Spinner size={20} />
        ) : (
          <div class="chips">
            {genres.map((g) => (
              <button
                key={g.id}
                class={`chip${selected.has(g.id) ? ' is-active' : ''}`}
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(g.id)) next.delete(g.id);
                  else next.add(g.id);
                  setSelected(next);
                }}
              >
                {g.title}
              </button>
            ))}
          </div>
        )}
        <Button full onClick={() => void save()} loading={busy}>
          {t('genres_save')}
        </Button>
      </div>
    </Sheet>
  );
}

const NOTIF_ROWS: { key: keyof NotificationPrefs; title: string; desc: string }[] = [
  { key: 'pushEnabled', title: 'settings_notif_push', desc: 'settings_notif_push_desc' },
  { key: 'likesEnabled', title: 'settings_notif_likes', desc: 'settings_notif_likes_desc' },
  { key: 'commentsEnabled', title: 'settings_notif_comments', desc: 'settings_notif_comments_desc' },
  { key: 'savesEnabled', title: 'settings_notif_saves', desc: 'settings_notif_saves_desc' },
  { key: 'followsEnabled', title: 'settings_notif_follows', desc: 'settings_notif_follows_desc' },
  { key: 'mentionsEnabled', title: 'settings_notif_mentions', desc: 'settings_notif_mentions_desc' },
];

function NotificationSheet({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .notificationPrefs()
      .then(setPrefs)
      .catch(() => toast(t('settings_error_load'), 'error'));
  }, []);

  async function toggle(key: keyof NotificationPrefs) {
    if (!prefs || saving) return;
    // Everything else depends on push being on, as it does on Android.
    if (key !== 'pushEnabled' && !prefs.pushEnabled) {
      toast(t('settings_notif_requires_push'));
      return;
    }
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    try {
      setPrefs(await api.setNotificationPrefs(next));
    } catch (e) {
      setPrefs(prefs);
      toast(errorMessage(e, t('settings_error_generic')), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={t('settings_notifications_title')} onClose={onClose}>
      {prefs === null ? (
        <Spinner size={20} />
      ) : (
        <div class="list">
          {NOTIF_ROWS.map((row) => (
            <button key={row.key} class="row" onClick={() => void toggle(row.key)}>
              <div class="row-main">
                <div class="row-title">{t(row.title)}</div>
                <div class="row-sub">{t(row.desc)}</div>
              </div>
              <span class={`toggle${prefs[row.key] ? ' is-on' : ''}`} />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function BlockedSheet({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<BlockRow[] | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const res = await api.blocks();
      setRows(res.blocks ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function unblock(userId: string) {
    try {
      await api.unblock(userId);
      setRows((prev) => prev?.filter((r) => r.user?.id !== userId) ?? prev);
    } catch {
      toast(t('blocked_users_unblock_failed'), 'error');
    }
  }

  return (
    <Sheet title={t('settings_blocked_users')} onClose={onClose}>
      {error ? (
        <div class="stack">
          <p class="muted">{t('blocked_users_load_failed')}</p>
          <Button variant="outline" onClick={() => void load()}>
            {t('blocked_users_retry')}
          </Button>
        </div>
      ) : rows === null ? (
        <Spinner size={20} />
      ) : rows.length === 0 ? (
        <p class="muted small">{t('blocked_users_empty')}</p>
      ) : (
        <div class="list">
          {rows.map((row) => (
            <div key={row.user?.id} class="row">
              <Avatar url={row.user?.avatarUrl} name={row.user?.username} size={38} />
              <div class="row-main">
                <div class="row-title">@{row.user?.username}</div>
              </div>
              <button
                class="btn btn-outline btn-sm"
                onClick={() => row.user?.id && void unblock(row.user.id)}
              >
                {t('blocked_users_unblock')}
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
