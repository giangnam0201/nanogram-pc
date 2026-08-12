import { useEffect, useState } from 'preact/hooks';
import { profile } from '../lib/api';
import { errorMessage, ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back, me, toast } from '../lib/store';
import { Button, ErrorState, FullSpinner, Spinner, formatCount, timeAgo } from '../components/common';
import { Icon } from '../components/Icon';
import type { Achievement, CreditTransaction, Credits } from '../lib/types';

/* Credits, matching the Android screen: the daily allowance and the bank
   ("reserve") that never expires, the ways to earn more, and the ledger. */

interface EarnRow {
  id: string;
  icon: string;
  title: string;
  body: string;
  /** Server achievement ids that map onto this row, when it reports progress. */
  progress?: { done: number | null | undefined; total: number | null | undefined };
}

function resetsIn(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function kindLabel(kind?: string | null): string {
  switch (kind) {
    case 'referral_bonus':
      return t('credits_kind_referral_bonus');
    case 'opus_charge':
      return t('credits_kind_opus_charge');
    case 'promo_code':
      return t('credits_kind_promo_code');
    case 'admin_grant':
      return t('credits_kind_admin_grant');
    default:
      return t('credits_kind_default');
  }
}

export function CreditsScreen() {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [history, setHistory] = useState<CreditTransaction[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load() {
    try {
      const [c, a, h] = await Promise.all([
        profile.credits(),
        profile.achievements().catch(() => ({ achievements: [] })),
        profile.creditHistory().catch(() => ({ transactions: [] })),
      ]);
      setCredits(c);
      setAchievements(a.achievements ?? []);
      setHistory(h.transactions ?? []);
      setCursor((h as { nextCursor?: number | null }).nextCursor ?? null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('credits_error_load')));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function more() {
    if (cursor == null) return;
    setLoadingMore(true);
    try {
      const res = await profile.creditHistory(cursor);
      setHistory((prev) => [...(prev ?? []), ...(res.transactions ?? [])]);
      setCursor(res.nextCursor ?? null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  async function copyInvite() {
    const code = me.value?.referralCode;
    if (!code) return;
    try {
      const link = await ipc.inviteUrl(code);
      await navigator.clipboard.writeText(link);
      toast(t('credits_invite_copied'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function shareInvite() {
    const code = me.value?.referralCode;
    if (!code) return;
    const link = await ipc.inviteUrl(code);
    const text = t('credits_invite_share_text', link);
    if (navigator.share) {
      try {
        await navigator.share({ title: t('credits_invite_share_subject'), text });
        return;
      } catch {
        /* user dismissed the sheet */
      }
    }
    await navigator.clipboard.writeText(`${text}`).catch(() => {});
    toast(t('credits_invite_copied'));
  }

  if (error && !credits) return <ErrorState text={error} onRetry={() => void load()} />;
  if (!credits) return <FullSpinner />;

  const byId = new Map((achievements ?? []).map((a) => [a.id ?? '', a]));
  const earn: EarnRow[] = [
    {
      id: 'invite',
      icon: 'ic_group_add',
      title: t('credits_earn_invite_title'),
      body: t('credits_earn_invite_body'),
    },
    {
      id: 'share',
      icon: 'ic_streamline_share',
      title: t('credits_earn_share_title'),
      body: t('credits_earn_share_body'),
      progress: { done: credits.shareClicksToday, total: credits.shareClicksDailyMax },
    },
    {
      id: 'ten_likes',
      icon: 'ic_streamline_like',
      title: t('credits_earn_likes_title'),
      body: t('credits_earn_likes_body'),
      progress: { done: credits.tenLikesToday, total: credits.tenLikesDailyMax },
    },
    {
      id: 'publish',
      icon: 'ic_publish',
      title: t('credits_earn_publish_title'),
      body: t('credits_earn_publish_body'),
    },
    {
      id: 'friend_ships',
      icon: 'ic_rocket_launch',
      title: t('credits_earn_ships_title'),
      body: t('credits_earn_ships_body'),
    },
    {
      id: 'friend_viral',
      icon: 'ic_local_fire_department',
      title: t('credits_earn_viral_title'),
      body: t('credits_earn_viral_body'),
    },
    {
      id: 'streak',
      icon: 'ic_local_offer',
      title: t('credits_earn_streak_title'),
      body: t('credits_earn_streak_body'),
    },
  ];

  const resets = resetsIn(credits.resetsAt);

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">{t('credits_title')}</h1>
      </div>

      <div class="screen-pad" style={{ maxWidth: 780 }}>
        <section class="credit-hero">
          <div class="ng-caption">{t('credits_available')}</div>
          <div class="credit-total">
            {formatCount(Math.floor((credits.remainingToday ?? 0) + (credits.bankBalance ?? 0)))}
          </div>
          <div class="credit-split">
            <div>
              <div class="stat-num">{Math.floor(credits.remainingToday ?? 0)}</div>
              <div class="stat-label">
                {t('credits_daily_label')}
                {resets ? ` · ${t('credits_resets_in', resets)}` : ''}
              </div>
            </div>
            <div>
              <div class="stat-num">{Math.floor(credits.bankBalance ?? 0)}</div>
              <div class="stat-label">
                {t('credits_reserve')} · {t('credits_never_expires')}
              </div>
            </div>
          </div>
        </section>

        <section class="invite-card">
          <h2 class="ng-title-sm">{t('credits_invite_title')}</h2>
          <p class="ng-body-sm muted">{t('credits_invite_body')}</p>
          {me.value?.referralCode && (
            <button class="invite-link" onClick={() => void copyInvite()} title={t('share_copy_link')}>
              <span class="truncate">
                {t('credits_invite_link_prefix')}
                {me.value.referralCode}
              </span>
              <Icon name="ic_content_copy" size={16} />
            </button>
          )}
          <Button onClick={() => void shareInvite()}>
            <Icon name="ic_streamline_share" size={16} />
            {t('credits_invite_share')}
          </Button>
        </section>

        <h2 class="section-title">{t('credits_earn_title')}</h2>
        <div class="list">
          {earn.map((row) => {
            const achievement = byId.get(row.id);
            const done = row.progress?.done ?? achievement?.progress;
            const total = row.progress?.total ?? achievement?.target;
            return (
              <div key={row.id} class="row">
                <div class="earn-icon">
                  <Icon name={row.icon} size={18} />
                </div>
                <div class="row-main">
                  <div class="row-title">{row.title}</div>
                  <div class="row-sub">{row.body}</div>
                  {total != null && (
                    <div class="ng-caption">{t('credits_earn_progress_today', done ?? 0, total)}</div>
                  )}
                </div>
                {achievement?.reward != null && (
                  <span class="earn-reward">{t('credits_earn_reward', achievement.reward)}</span>
                )}
              </div>
            );
          })}
        </div>

        <h2 class="section-title">{t('credits_history_title')}</h2>
        {history === null ? (
          <Spinner size={18} />
        ) : history.length === 0 ? (
          <p class="muted small">{t('credits_history_empty')}</p>
        ) : (
          <div class="list">
            {history.map((tx, i) => {
              const delta = tx.delta ?? 0;
              const positive = delta >= 0;
              return (
                <div key={tx.id ?? i} class="row">
                  <div class="row-main">
                    <div class="row-title">{tx.description || kindLabel(tx.kind)}</div>
                    <div class="row-sub">
                      {t('credits_history_meta', kindLabel(tx.kind), timeAgo(tx.createdAt))}
                    </div>
                  </div>
                  <span class={positive ? 'delta-up' : 'delta-down'}>
                    {positive
                      ? t('credits_history_credit', Math.abs(delta))
                      : t('credits_history_spend', Math.abs(delta))}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {cursor != null && (
          <div style={{ display: 'grid', placeItems: 'center', marginTop: 16 }}>
            <Button variant="outline" loading={loadingMore} onClick={() => void more()}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
