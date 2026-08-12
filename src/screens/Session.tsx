import { useEffect, useRef, useState } from 'preact/hooks';
import { gamegen } from '../lib/api';
import { errorMessage, ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { parseAssistant } from '../lib/gamegen';
import { back, navigate, toast } from '../lib/store';
import { Button, FullSpinner, Sheet, Spinner } from '../components/common';
import { Icon } from '../components/Icon';
import { GAME_SANDBOX } from '../components/GamePlayer';
import type { GameGenMessage, MessagesResponse } from '../lib/types';

/* The GameGen workspace: chat with the model on the left, live HTML preview of
   the current build on the right, publish when happy. Matches the Android
   create flow, laid out for a wider window. */

const POLL_MS = 3000;

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<MessagesResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTitle, setPublishTitle] = useState('');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await gamegen.messages(sessionId);
      setData(res);
      setPublishTitle((prev) => prev || res.title || '');
      return res;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return null;
    }
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  /* While the model is building, poll for the new snapshot. */
  useEffect(() => {
    if (!building) return;
    const id = window.setInterval(async () => {
      const res = await load();
      const last = res?.messages?.[res.messages.length - 1];
      if (last && last.status && last.status !== 'pending' && last.status !== 'running') {
        setBuilding(false);
      }
      const flight = await gamegen.inFlight().catch(() => null);
      if (flight && flight.inFlight === false) setBuilding(false);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [building, sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [data?.messages?.length]);

  async function send(explicit?: string) {
    const text = (explicit ?? draft).trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await gamegen.sendMessage(sessionId, text);
      setData((prev) =>
        prev
          ? {
              ...prev,
              messages: [...(prev.messages ?? []), res.userMessage, res.assistantMessage],
            }
          : prev,
      );
      setDraft('');
      setBuilding(true);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSending(false);
    }
  }

  async function publish() {
    const title = publishTitle.trim();
    if (!title) return;
    setPublishing(true);
    try {
      const res = await gamegen.publish(sessionId, title);
      setPublishOpen(false);
      if (res.gameId) {
        navigate({ name: 'game', gameId: res.gameId });
      } else {
        back();
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setPublishing(false);
    }
  }

  async function revert(message: GameGenMessage) {
    try {
      await gamegen.revert(sessionId, message.id);
      await load();
      toast('Reverted');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const html = data ? (data.remixHtml ?? lastSnapshot(data.messages)) : null;

  // Stage each new build with Rust so it can be served on its own origin.
  useEffect(() => {
    let alive = true;
    if (!html) {
      setPreviewSrc(null);
      return;
    }
    void ipc
      .stagePreview(html)
      .then((id) => {
        if (alive) setPreviewSrc(ipc.previewSrc(id));
      })
      .catch(() => {
        if (alive) setPreviewSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [html]);

  if (!data) return <FullSpinner />;

  return (
    <div class="screen" style={{ overflow: 'hidden', height: '100%' }}>
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title truncate">{data.title ?? t('create_untitled_draft')}</h1>
        <span class="spacer" />
        {building && (
          <span class="hstack small muted">
            <Spinner size={14} />
            {t('create_generating_building')}
          </span>
        )}
        <Button variant="primary" onClick={() => setPublishOpen(true)} disabled={!html || building}>
          <Icon name="ic_publish" size={16} />
          Publish
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 1fr) minmax(300px, 460px)',
          gap: 0,
          height: 'calc(100% - 66px)',
        }}
      >
        <div class="chat" style={{ gridTemplateRows: '1fr auto', borderRight: '1px solid var(--line)' }}>
          <div class="chat-log" ref={logRef}>
            {data.messages?.map((m, index) => {
              const isUser = m.role === 'user';
              const parsed = isUser ? null : parseAssistant(m.content);
              // Only the newest question is still answerable.
              const isLast = index === (data.messages?.length ?? 0) - 1;
              const options = isLast && !building ? (parsed?.options ?? []) : [];

              return (
                <div key={m.id} class="msg-group">
                  <div class={`bubble ${isUser ? 'bubble-out' : 'bubble-in'}`}>
                    {isUser ? m.content : parsed?.text}
                    {!isUser && m.htmlSnapshot && (
                      <button
                        class="small muted"
                        style={{ display: 'block', marginTop: 6 }}
                        onClick={() => void revert(m)}
                      >
                        <Icon name="ic_undo_arrow" size={12} /> Revert to here
                      </button>
                    )}
                  </div>

                  {options.length > 0 && (
                    <div class="choice-row">
                      {options.map((option) => (
                        <button
                          key={option}
                          class="choice"
                          disabled={sending}
                          onClick={() => void send(option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {building && (
              <div class="bubble bubble-in">
                <span class="hstack">
                  <Spinner size={14} />
                  {t('create_generating_subtitle')}
                </span>
              </div>
            )}
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
              placeholder={t('discover_describe_idea')}
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <button class="btn btn-primary" type="submit" disabled={!draft.trim() || sending}>
              {sending ? <Spinner size={14} /> : <Icon name="ic_streamline_arrow_up_right" size={16} />}
            </button>
          </form>
        </div>

        <div style={{ background: '#000', display: 'grid', placeItems: 'center', minHeight: 0 }}>
          {previewSrc ? (
            <iframe
              src={previewSrc}
              title="Preview"
              sandbox={GAME_SANDBOX}
              allow="autoplay; fullscreen; gamepad"
              style={{ width: '100%', height: '100%', border: 0, aspectRatio: '9 / 16' }}
            />
          ) : (
            <p class="muted small" style={{ padding: 24, textAlign: 'center' }}>
              {t('create_generating_title')}
            </p>
          )}
        </div>
      </div>

      {publishOpen && (
        <Sheet title="Publish game" onClose={() => setPublishOpen(false)}>
          <div class="stack">
            <input
              class="input"
              placeholder={t('profile_rename_game_hint')}
              value={publishTitle}
              maxLength={80}
              onInput={(e) => setPublishTitle((e.target as HTMLInputElement).value)}
            />
            <Button full onClick={() => void publish()} loading={publishing} disabled={!publishTitle.trim()}>
              {t('create_prompt_send') && 'Publish'}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function lastSnapshot(messages?: GameGenMessage[] | null): string | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const snapshot = messages[i].htmlSnapshot;
    if (snapshot) return snapshot;
  }
  return null;
}
