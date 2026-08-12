import { useEffect, useState } from 'preact/hooks';
import { chat as chatApi } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { me, navigate, toast } from '../lib/store';
import { Avatar, EmptyState, ErrorState, FullSpinner, Sheet, timeAgo } from '../components/common';
import { Icon } from '../components/Icon';
import type { Chat, FriendUser } from '../lib/types';

type Box = 'chats' | 'requests';

export function InboxScreen() {
  const [box, setBox] = useState<Box>('chats');
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  async function load() {
    setChats(null);
    try {
      const res = box === 'chats' ? await chatApi.list() : await chatApi.requests();
      setChats(res.chats ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('chat_error_load')));
    }
  }

  useEffect(() => {
    void load();
  }, [box]);

  if (me.value?.parentalControls?.chatsLocked) {
    return (
      <div class="screen">
        <div class="center-fill state">
          <Icon name="ic_settings_lock" size={36} />
          <h2 class="screen-title">{t('chat_disabled_title')}</h2>
          <p class="state-text">{t('chat_disabled_body')}</p>
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      <div class="screen-head">
        <h1 class="screen-title">Inbox</h1>
        <span class="spacer" />
        <button class="icon-btn" onClick={() => navigate({ name: 'notifications' })} aria-label="Notifications">
          <Icon name="ic_bell" size={19} />
        </button>
        <button class="icon-btn" onClick={() => setNewOpen(true)} aria-label={t('chat_new_chat_title')}>
          <Icon name="ic_pill_plus" size={19} />
        </button>
      </div>

      <div class="screen-pad">
        <div class="tabs">
          <button class={`tab${box === 'chats' ? ' is-active' : ''}`} onClick={() => setBox('chats')}>
            Chats
          </button>
          <button
            class={`tab${box === 'requests' ? ' is-active' : ''}`}
            onClick={() => setBox('requests')}
          >
            Requests
          </button>
        </div>

        {error ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : chats === null ? (
          <FullSpinner />
        ) : chats.length === 0 ? (
          <EmptyState text={t('chat_empty')} icon="ic_navbar_inbox" />
        ) : (
          <div class="list" style={{ marginTop: 8 }}>
            {chats.map((c) => (
              <button
                key={c.id}
                class="row"
                onClick={() => navigate({ name: 'chat', chatId: c.id })}
              >
                <Avatar url={c.otherUser?.avatarUrl} name={c.otherUser?.username} size={46} />
                <div class="row-main">
                  <div class="row-title">@{c.otherUser?.username ?? 'unknown'}</div>
                  <div class="row-sub">
                    {c.lastMessage?.text ??
                      (c.lastMessage?.game ? `🎮 ${c.lastMessage.game.title ?? 'a game'}` : t('chat_no_messages_preview'))}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div class="small muted">{timeAgo(c.lastMessageAt ?? c.createdAt)}</div>
                  {(c.unreadCount ?? 0) > 0 && <span class="nav-badge" style={{ position: 'static' }}>{c.unreadCount}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {newOpen && <NewChatSheet onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function NewChatSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<FriendUser[] | null>(null);

  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(async () => {
      try {
        const res = query.trim()
          ? await chatApi.searchFriends(query.trim())
          : await chatApi.friends();
        if (alive) setUsers(res.users ?? []);
      } catch {
        if (alive) setUsers([]);
      }
    }, query ? 250 : 0);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [query]);

  async function start(user: FriendUser) {
    try {
      const chat = await chatApi.create(user.id);
      onClose();
      navigate({ name: 'chat', chatId: chat.id });
    } catch (e) {
      toast(errorMessage(e, t('chat_error_create')), 'error');
    }
  }

  return (
    <Sheet title={t('chat_new_chat_title')} onClose={onClose}>
      <div class="stack">
        <input
          class="input"
          placeholder={t('chat_new_chat_search')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        {users === null ? (
          <FullSpinner />
        ) : users.length === 0 ? (
          <p class="muted small">{t('chat_new_chat_empty')}</p>
        ) : (
          <div class="list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {users.map((u) => (
              <button key={u.id} class="row" onClick={() => void start(u)}>
                <Avatar url={u.avatarUrl} name={u.username} size={40} />
                <div class="row-main">
                  <div class="row-title">@{u.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
