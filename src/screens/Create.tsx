import { useEffect, useState } from 'preact/hooks';
import { gamegen } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { cdnUrl } from '../lib/cdn';
import { navigate, toast } from '../lib/store';
import { Button, EmptyState, Spinner, formatCount, timeAgo } from '../components/common';
import { Icon } from '../components/Icon';
import type { Credits, GameGenStyle, PromptBreakdown, SessionSummary } from '../lib/types';

/* Create mirrors the Android flow: choose the look first, then describe the
   game. "Break down my idea" asks the server to split the prompt into aspects,
   which come back as suggestions you can fold into the description. */

type Step = 'style' | 'prompt';

export function CreateScreen() {
  const [step, setStep] = useState<Step>('style');
  const [styles, setStyles] = useState<GameGenStyle[] | null>(null);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [breakdown, setBreakdown] = useState<PromptBreakdown | null>(null);
  const [breaking, setBreaking] = useState(false);
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
        setStyles(s.styles ?? []);
        setDrafts(d.sessions ?? []);
        setCredits(c);
      } catch (e) {
        toast(errorMessage(e, t('create_error_load_drafts')), 'error');
        setStyles([]);
        setDrafts([]);
      }
    })();

    // Drop straight back into a build that is still running.
    void gamegen
      .inFlight()
      .then((f) => {
        if (f.inFlight && f.sessionId) navigate({ name: 'session', sessionId: f.sessionId });
      })
      .catch(() => {});
  }, []);

  const style = styles?.find((s) => s.id === styleId) ?? null;

  async function breakItDown() {
    const input = prompt.trim();
    if (!input) return;
    setBreaking(true);
    try {
      setBreakdown(await gamegen.promptBreakdown(input));
    } catch (e) {
      toast(errorMessage(e, t('create_error_breakdown')), 'error');
    } finally {
      setBreaking(false);
    }
  }

  async function create() {
    const description = prompt.trim();
    if (!description || !styleId) return;
    setCreating(true);
    try {
      const session = await gamegen.createSession({
        styleId,
        dimension: style?.dimension ?? undefined,
        description,
        remixHtml: '',
      });
      // The first message is what actually starts the build.
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
        {step === 'prompt' && (
          <button class="icon-btn" onClick={() => setStep('style')} aria-label="Back">
            <Icon name="ic_chevron_left" size={20} />
          </button>
        )}
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
        {step === 'style' ? (
          <>
            <h2 class="ng-title-md">Pick a style</h2>
            <p class="ng-body-sm muted" style={{ marginTop: 4 }}>
              This sets how your game looks. You can change it before building.
            </p>

            {styles === null ? (
              <Spinner size={20} />
            ) : (
              <div class="style-grid">
                {styles.map((s) => (
                  <button
                    key={s.id}
                    class={`style-card${styleId === s.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setStyleId(s.id ?? null);
                      setStep('prompt');
                    }}
                  >
                    <div class="style-shot">
                      {s.screenshotUrl ? (
                        <img src={cdnUrl(s.screenshotUrl)} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <Icon name="ic_gameboy" size={28} />
                      )}
                      <span class="style-dim">
                        <Icon
                          name={s.dimension === '3d' ? 'ic_dimension_3d' : 'ic_dimension_2d'}
                          size={13}
                        />
                        {(s.dimension ?? '2d').toUpperCase()}
                      </span>
                    </div>
                    <div class="card-title">{s.name}</div>
                    <div class="card-sub">{s.description}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div class="hstack" style={{ marginBottom: 12 }}>
              <Icon
                name={style?.dimension === '3d' ? 'ic_dimension_3d' : 'ic_dimension_2d'}
                size={16}
              />
              <strong>{style?.name}</strong>
              <button class="chip" onClick={() => setStep('style')}>
                <Icon name="ic_swap_horiz" size={14} />
                <span style={{ marginLeft: 6 }}>Change</span>
              </button>
            </div>

            <textarea
              class="textarea"
              autoFocus
              placeholder={t('create_prompt_placeholder')}
              value={prompt}
              maxLength={1000}
              onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
            />

            <div class="hstack" style={{ marginTop: 12 }}>
              <Button onClick={() => void create()} loading={creating} disabled={!prompt.trim()}>
                <Icon name="ic_auto_awesome" size={16} />
                Build my game
              </Button>
              <Button
                variant="outline"
                onClick={() => void breakItDown()}
                loading={breaking}
                disabled={!prompt.trim()}
              >
                <Icon name="ic_generate_insight" size={16} />
                {t('create_prompt_send')}
              </Button>
            </div>

            {breakdown?.values && breakdown.values.length > 0 && (
              <>
                <h2 class="section-title">Ideas to build on</h2>
                <div class="list">
                  {breakdown.values.map((v, i) => (
                    <button
                      key={v.key ?? i}
                      class="row"
                      onClick={() => {
                        const add = v.suggestion || v.value;
                        if (add) setPrompt((p) => `${p.trim()} ${add}`.trim());
                      }}
                    >
                      <div class="earn-icon">
                        <Icon name="ic_sparkle" size={16} />
                      </div>
                      <div class="row-main">
                        <div class="row-title">{v.value || v.key}</div>
                        {v.suggestion && <div class="row-sub">{v.suggestion}</div>}
                      </div>
                      <Icon name="ic_pill_plus" size={15} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

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
