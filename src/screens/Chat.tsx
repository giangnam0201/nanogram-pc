import { useEffect, useRef, useState } from 'preact/hooks';
import { chat as chatApi } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back, me, navigate, toast } from '../lib/store';
import { Avatar, FullSpinner, Spinner } from '../components/common';
import { Icon } from '../components/Icon';
import type { Chat, ChatMessage } from '../lib/types';

const POLL_MS = 5000;

export function ChatScreen({ chatId }: { chatId: string }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function load(silent = false) {
    try {
      const [c, m] = await Promise.all([
        silent ? Promise.resolve(chat) : chatApi.get(chatId),
        chatApi.messages(chatId),
      ]);
      if (c) setChat(c);
      // The API returns newest-first; the log reads oldest-first.
      const ordered = [...(m.messages ?? [])].reverse();
      setMessages(ordered);
      const last = ordered[ordered.length - 1];
      if (last?.id) void chatApi.markRead(chatId, last.id).catch(() => {});
    } catch (e) {
      if (!silent) toast(errorMessage(e, t('chat_error_load')), 'error');
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [chatId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages?.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id: nonce,
      chatId,
      senderId: me.value?.id,
      text,
      clientNonce: nonce,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    setDraft('');
    setSending(true);
    try {
      const saved = await chatApi.send(chatId, { text, clientNonce: nonce });
      setMessages((prev) => prev?.map((m) => (m.clientNonce === nonce ? saved : m)) ?? prev);
    } catch (e) {
      setMessages((prev) => prev?.filter((m) => m.clientNonce !== nonce) ?? prev);
      setDraft(text);
      toast(errorMessage(e, t('chat_error_send')), 'error');
    } finally {
      setSending(false);
    }
  }

  if (messages === null) return <FullSpinner />;

  const other = chat?.otherUser;

  return (
    <div class="chat">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <button
          class="hstack"
          onClick={() => other?.id && navigate({ name: 'user', userId: other.id })}
        >
          <Avatar url={other?.avatarUrl} name={other?.username} size={34} />
          <strong>@{other?.username ?? '…'}</strong>
        </button>
        <span class="spacer" />
      </div>

      <div class="chat-log" ref={logRef}>
        {messages.length === 0 && <p class="muted small">{t('chat_empty')}</p>}
        {messages.map((m) => {
          const mine = m.senderId === me.value?.id;
          return (
            <div key={m.id} class={`bubble ${mine ? 'bubble-out' : 'bubble-in'}`}>
              {m.game ? (
                <button
                  class="hstack"
                  onClick={() => m.game && navigate({ name: 'game', gameId: m.game.id })}
                >
                  {m.game.thumbnailUrl && (
                    <img src={m.game.thumbnailUrl} alt="" class="row-thumb" style={{ width: 44, height: 44 }} />
                  )}
                  <span>{m.gameUnavailable ? t('chat_game_unavailable') : m.game.title}</span>
                </button>
              ) : (
                m.text
              )}
            </div>
          );
        })}
      </div>

      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          class="input"
          placeholder={t('chat_composer_placeholder')}
          value={draft}
          maxLength={1000}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-primary" type="submit" disabled={!draft.trim() || sending}>
          {sending ? <Spinner size={14} /> : t('share_send')}
        </button>
      </form>
    </div>
  );
}
