import { useEffect, useState } from 'preact/hooks';
import { gamegen } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { cdnUrl } from '../lib/cdn';
import { navigate, toast } from '../lib/store';
import { Button, EmptyState, Spinner, formatCount, timeAgo } from '../components/common';
import { Icon } from '../components/Icon';
import type { Credits, GameGenStyle, SessionSummary } from '../lib/types';

export function CreateScreen() {
  const [prompt, setPrompt] = useState('');
  const [styles, setStyles] = useState<GameGenStyle[] | null>(null);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SessionSummary[] | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [s, d, c] = await Promise.all([
          gamegen.styles(),
          gamegen.sessions(),
          gamegen.credits().catch(() => null),
        ]);
        const list = s.styles ?? [];
        setStyles(list);
        setStyleId(list[0]?.id ?? null);
        setDrafts(d.sessions ?? []);
        setCredits(c);
      } catch (e) {
        toast(errorMessage(e, t('create_error_load_drafts')), 'error');
        setStyles([]);
        setDrafts([]);
      }
    })();

    // If a generation is already running, drop the user straight into it.
    void gamegen
      .inFlight()
      .then((f) => {
        if (f.inFlight && f.sessionId) {
          navigate({ name: 'session', sessionId: f.sessionId });
        }
      })
      .catch(() => {});
  }, []);

  async function create() {
    const description = prompt.trim();
    if (!description || !styleId) return;
    setCreating(true);
    try {
      const session = await gamegen.createSession({
        styleId,
        description,
        remixHtml: '',
      });
      // The first message is what kicks the build off.
      await gamegen.sendMessage(session.id, description);
      navigate({ name: 'session', sessionId: session.id });
    } catch (e) {
      toast(errorMessage(e, t('create_error_breakdown')), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function removeDraft(id: string) {
    try {
      await gamegen.deleteSession(id);
      setDrafts((prev) => prev?.filter((d) => d.id !== id) ?? prev);
    } catch (e) {
      toast(errorMessage(e, t('create_error_delete_draft')), 'error');
    }
  }

  return (
    <div class="screen">
      <div class="screen-head">
        <h1 class="screen-title">{t('create_screen_title')}</h1>
        <span class="spacer" />
        {credits && (
          <button class="chip" onClick={() => navigate({ name: 'credits' })}>
            <Icon name="ic_credit_card" size={15} />
            <span style={{ marginLeft: 6 }}>
              {formatCount(Math.floor((credits.remainingToday ?? 0) + (credits.bankBalance ?? 0)))}{' '}
              {t('profile_credits')}
            </span>
          </button>
        )}
      </div>

      <div class="screen-pad">
        <div class="stack">
          <textarea
            class="textarea"
            placeholder={t('create_prompt_placeholder')}
            value={prompt}
            maxLength={1000}
            onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
          />

          {styles === null ? (
            <Spinner size={18} />
          ) : (
            styles.length > 0 && (
              <div class="chips">
                {styles.map((s) => (
                  <button
                    key={s.id}
                    class={`chip${styleId === s.id ? ' is-active' : ''}`}
                    onClick={() => setStyleId(s.id ?? null)}
                  >
                    <Icon
                      name={s.dimension === '3d' ? 'ic_dimension_3d' : 'ic_dimension_2d'}
                      size={15}
                    />
                    <span style={{ marginLeft: 6 }}>{s.name}</span>
                  </button>
                ))}
              </div>
            )
          )}

          <Button onClick={() => void create()} disabled={!prompt.trim() || !styleId} loading={creating}>
            <Icon name="ic_auto_awesome" size={17} />
            {t('create_prompt_send')}
          </Button>
        </div>

        <h2 class="section-title">{t('create_drafts_title')}</h2>

        {drafts === null && <Spinner size={20} />}
        {drafts?.length === 0 && <EmptyState text={t('create_no_drafts')} icon="ic_gameboy" />}

        <div class="grid">
          {drafts?.map((d) => (
            <div key={d.id} style={{ position: 'relative' }}>
              <button
                class="card"
                onClick={() => navigate({ name: 'session', sessionId: d.id })}
                style={{ width: '100%' }}
              >
                <div class="card-thumb">
                  {d.thumbnailUrl || d.publishedGameThumbnailUrl ? (
                    <img
                      src={cdnUrl(d.thumbnailUrl ?? d.publishedGameThumbnailUrl)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div class="center-fill">
                      <Icon name="ic_sparkle" size={28} />
                    </div>
                  )}
                  {d.publishedGameId && <span class="card-badge">Published</span>}
                </div>
                <div class="card-title">
                  {d.title ?? d.firstMessage ?? t('create_untitled_draft')}
                </div>
                <div class="card-sub">{timeAgo(d.updatedAt)}</div>
              </button>
              <button
                class="icon-btn"
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.5)' }}
                aria-label={t('create_delete_draft')}
                onClick={() => void removeDraft(d.id)}
              >
                <Icon name="ic_streamline_trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
