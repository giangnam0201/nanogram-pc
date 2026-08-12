import { useEffect, useState } from 'preact/hooks';
import { Sheet, Avatar, Button, Spinner } from './common';
import { Icon } from './Icon';
import { chat as chatApi, games } from '../lib/api';
import { errorMessage, ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { toast } from '../lib/store';
import type { FriendUser } from '../lib/types';

/* Mirrors the Android share sheet: send to a friend in-app, copy the link, or
   hand off to an external target. Every path records the share server-side via
   POST v2/games/{id}/share so counters and creator credits stay correct. */

interface Props {
  gameId: string;
  title?: string | null;
  author?: string | null;
  onClose: () => void;
  onShared?: (count: number | null) => void;
}

const EXTERNAL: { key: string; icon: string; url: (link: string, text: string) => string }[] = [
  {
    key: 'share_whatsapp',
    icon: 'ic_share_whatsapp',
    url: (link, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
  },
  {
    key: 'share_messenger',
    icon: 'ic_share_messenger',
    url: (link) => `https://www.facebook.com/dialog/send?link=${encodeURIComponent(link)}`,
  },
  {
    key: 'share_tiktok',
    icon: 'ic_share_tiktok',
    url: () => 'https://www.tiktok.com/upload',
  },
  {
    key: 'share_snapchat',
    icon: 'ic_share_snapchat',
    url: (link) => `https://www.snapchat.com/scan?attachmentUrl=${encodeURIComponent(link)}`,
  },
];

export function ShareSheet({ gameId, title, author, onClose, onShared }: Props) {
  const [link, setLink] = useState('');
  const [friends, setFriends] = useState<FriendUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const shareText = author
    ? t('share_game_text_by_author', title ?? '', author, '')
    : t('share_game_text', title ?? '', '');

  useEffect(() => {
    void ipc.shareUrl(gameId).then(setLink);
  }, [gameId]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const res = query.trim()
          ? await chatApi.searchFriends(query.trim())
          : await chatApi.friends();
        if (alive) setFriends(res.users ?? []);
      } catch {
        if (alive) setFriends([]);
      }
    };
    const id = window.setTimeout(run, query ? 250 : 0);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [query]);

  /** Record the share once, whatever the destination was. */
  async function recordShare() {
    try {
      const res = await games.share(gameId);
      onShared?.(res.sharesCount ?? null);
    } catch {
      /* the share itself already happened; don't block the user on this */
    }
  }

  async function sendToFriend(user: FriendUser) {
    setSending(user.id);
    try {
      const chat = await chatApi.create(user.id);
      await chatApi.send(chat.id, {
        gameId,
        clientNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setSent(new Set([...sent, user.id]));
      await recordShare();
      toast(t('share_sent_toast'));
    } catch (e) {
      toast(errorMessage(e, t('chat_error_send')), 'error');
    } finally {
      setSending(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      await recordShare();
      toast(t('share_copy_link'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function openExternal(url: string) {
    try {
      await ipc.openExternal(url);
      await recordShare();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Sheet title={t('share_title')} onClose={onClose}>
      <div class="stack">
        <input
          class="input"
          placeholder={t('share_search_friends')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />

        <div class="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
          {friends === null && <Spinner size={20} />}
          {friends?.length === 0 && <p class="muted small">{t('chat_new_chat_empty')}</p>}
          {friends?.map((f) => (
            <div key={f.id} class="row">
              <Avatar url={f.avatarUrl} name={f.username} size={38} />
              <div class="row-main">
                <div class="row-title">@{f.username}</div>
              </div>
              <button
                class="btn btn-primary btn-sm"
                disabled={sending === f.id || sent.has(f.id)}
                onClick={() => void sendToFriend(f)}
              >
                {sending === f.id ? <Spinner size={14} /> : sent.has(f.id) ? '✓' : t('share_send')}
              </button>
            </div>
          ))}
        </div>

        <div class="divider">or</div>

        <Button full variant="outline" onClick={() => void copyLink()}>
          <Icon name="ic_share_link" size={17} />
          {t('share_copy_link')}
        </Button>

        <div class="chips">
          {EXTERNAL.map((target) => (
            <button
              key={target.key}
              class="chip"
              onClick={() => void openExternal(target.url(link, shareText))}
            >
              <Icon name={target.icon} size={16} />
              <span style={{ marginLeft: 6 }}>{t(target.key)}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
