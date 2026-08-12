import { useEffect, useState } from 'preact/hooks';
import { Sheet, Avatar, Spinner, formatCount, timeAgo } from './common';
import { Icon } from './Icon';
import { comments as api } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { me, navigate, toast } from '../lib/store';
import type { Comment } from '../lib/types';

interface Props {
  gameId: string;
  locked?: boolean;
  onClose: () => void;
  onCountChange?: (n: number) => void;
}

export function CommentsSheet({ gameId, locked, onClose, onCountChange }: Props) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  async function load(next?: string) {
    try {
      const res = await api.list(gameId, next);
      setItems((prev) => (next && prev ? [...prev, ...(res.comments ?? [])] : res.comments ?? []));
      setCursor(res.nextCursor ?? null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load();
  }, [gameId]);

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api.create(gameId, {
        body,
        parentId: replyTo?.id,
      });
      const created = res.comment;
      if (created) {
        setItems((prev) => (prev ? [created, ...prev] : [created]));
      }
      if (res.commentsCount != null) onCountChange?.(res.commentsCount);
      setDraft('');
      setReplyTo(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSending(false);
    }
  }

  async function toggleLike(c: Comment) {
    const liked = !!c.isLiked;
    // Optimistic: the sheet should feel instant, reconcile on response.
    setItems(
      (prev) =>
        prev?.map((x) =>
          x.id === c.id
            ? { ...x, isLiked: !liked, likesCount: (x.likesCount ?? 0) + (liked ? -1 : 1) }
            : x,
        ) ?? prev,
    );
    try {
      const res = liked ? await api.unlike(gameId, c.id) : await api.like(gameId, c.id);
      setItems(
        (prev) =>
          prev?.map((x) =>
            x.id === c.id
              ? { ...x, isLiked: res.isLiked ?? !liked, likesCount: res.likesCount ?? x.likesCount }
              : x,
          ) ?? prev,
      );
    } catch (e) {
      setItems(
        (prev) =>
          prev?.map((x) =>
            x.id === c.id
              ? { ...x, isLiked: liked, likesCount: (x.likesCount ?? 0) + (liked ? 1 : -1) }
              : x,
          ) ?? prev,
      );
      toast(errorMessage(e), 'error');
    }
  }

  async function remove(c: Comment) {
    try {
      await api.remove(gameId, c.id);
      setItems((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Sheet title={t('feed_comment')} onClose={onClose}>
      {locked ? (
        <p class="muted">{t('feed_comments_locked')}</p>
      ) : (
        <div class="stack">
          {items === null && !error && <Spinner size={20} />}
          {error && <p class="field-error">{error}</p>}
          {items?.length === 0 && <p class="muted small">No comments yet.</p>}

          <div class="list" style={{ maxHeight: '46vh', overflowY: 'auto' }}>
            {items?.map((c) => (
              <div key={c.id} class="row" style={{ alignItems: 'flex-start' }}>
                <button
                  onClick={() => c.author?.id && navigate({ name: 'user', userId: c.author.id })}
                >
                  <Avatar url={c.author?.avatarUrl} name={c.author?.username} size={34} />
                </button>
                <div class="row-main">
                  <div class="small">
                    <strong>@{c.author?.username ?? 'someone'}</strong>{' '}
                    <span class="muted">{timeAgo(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  {c.giphyUrl && (
                    <img
                      src={c.giphyUrl}
                      alt=""
                      style={{ maxWidth: 180, borderRadius: 10, marginTop: 6 }}
                    />
                  )}
                  <div class="hstack" style={{ marginTop: 4, gap: 14 }}>
                    <button class="small muted" onClick={() => setReplyTo(c)}>
                      Reply
                    </button>
                    {c.author?.id === me.value?.id && (
                      <button class="small muted" onClick={() => void remove(c)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <button
                  class={`rail-btn${c.isLiked ? ' is-on' : ''}`}
                  style={{ color: c.isLiked ? 'var(--brand)' : 'var(--text-3)' }}
                  onClick={() => void toggleLike(c)}
                  aria-label={t('feed_like')}
                >
                  <Icon
                    name={c.isLiked ? 'ic_streamline_like_filled' : 'ic_streamline_like'}
                    size={16}
                  />
                  <span class="rail-count">{formatCount(c.likesCount)}</span>
                </button>
              </div>
            ))}
          </div>

          {cursor && (
            <button class="btn btn-ghost" onClick={() => void load(cursor)}>
              Load more
            </button>
          )}

          {replyTo && (
            <div class="hstack small muted">
              <span>Replying to @{replyTo.author?.username}</span>
              <button class="icon-btn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <Icon name="ic_pill_close" size={14} />
              </button>
            </div>
          )}

          <form
            class="hstack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              class="input"
              placeholder={t('chat_composer_placeholder')}
              value={draft}
              maxLength={500}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <button class="btn btn-primary" type="submit" disabled={!draft.trim() || sending}>
              {sending ? <Spinner size={14} /> : t('share_send')}
            </button>
          </form>
        </div>
      )}
    </Sheet>
  );
}
