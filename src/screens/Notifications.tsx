import { useEffect, useState } from 'preact/hooks';
import { notifications as api } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { cdnUrl } from '../lib/cdn';
import { back, navigate, unreadNotifications } from '../lib/store';
import { Avatar, EmptyState, ErrorState, FullSpinner, timeAgo } from '../components/common';
import { Icon } from '../components/Icon';
import type { NotificationItem } from '../lib/types';

/* Event copy mirrors the Android notification rows. */
function describe(n: NotificationItem): string {
  const who = n.actors?.[0]?.username ? `@${n.actors[0].username}` : 'Someone';
  const more = (n.actorCount ?? 1) > 1 ? ` and ${(n.actorCount ?? 1) - 1} others` : '';
  const subject = n.game?.title ? `“${n.game.title}”` : 'your game';
  switch (n.eventType) {
    case 'like':
      return `${who}${more} liked ${subject}`;
    case 'comment':
      return `${who}${more} commented on ${subject}`;
    case 'save':
      return `${who}${more} saved ${subject}`;
    case 'follow':
      return `${who}${more} started following you`;
    case 'mention':
      return `${who} mentioned you`;
    case 'remix':
      return `${who}${more} remixed ${subject}`;
    default:
      return n.preview ?? `${who}${more} interacted with ${subject}`;
  }
}

export function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.list();
      setItems(res.notifications ?? []);
      unreadNotifications.value = res.unreadCount ?? 0;
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function markAll() {
    try {
      await api.markAllRead();
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
      unreadNotifications.value = 0;
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function open(n: NotificationItem) {
    if (n.id && !n.read) {
      void api.markRead(n.id).catch(() => {});
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? prev);
      unreadNotifications.value = Math.max(0, unreadNotifications.value - 1);
    }
    if (n.gameId) navigate({ name: 'game', gameId: n.gameId });
    else if (n.actors?.[0]?.id) navigate({ name: 'user', userId: n.actors[0].id });
  }

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">{t('profile_notifications')}</h1>
        <span class="spacer" />
        <button class="chip" onClick={() => void markAll()}>
          <Icon name="ic_streamline_check" size={14} />
          <span style={{ marginLeft: 6 }}>Mark all read</span>
        </button>
      </div>

      <div class="screen-pad">
        {error ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : items === null ? (
          <FullSpinner />
        ) : items.length === 0 ? (
          <EmptyState text="Nothing here yet." icon="ic_bell" />
        ) : (
          <div class="list">
            {items.map((n, i) => (
              <button
                key={n.id ?? i}
                class="row"
                style={{ background: n.read ? undefined : 'var(--brand-dim)' }}
                onClick={() => void open(n)}
              >
                <Avatar url={n.actors?.[0]?.avatarUrl} name={n.actors?.[0]?.username} size={42} />
                <div class="row-main">
                  <div style={{ fontSize: 14 }}>{describe(n)}</div>
                  <div class="row-sub">{timeAgo(n.createdAt ?? n.updatedAt)}</div>
                </div>
                {n.game?.thumbnailUrl && (
                  <img src={cdnUrl(n.game.thumbnailUrl)} alt="" class="row-thumb" loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
