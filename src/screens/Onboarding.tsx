import { useEffect, useState } from 'preact/hooks';
import { auth } from '../lib/api';
import { errorMessage, isApiError } from '../lib/ipc';
import { apiErrorText, t } from '../lib/i18n';
import { loadMe, signOut, toast } from '../lib/store';
import { Button, Spinner } from '../components/common';
import { Icon } from '../components/Icon';

/* Nanogram's own onboarding: username → date of birth → optional referral,
   finished with POST v2/auth/onboarding. */

type Step = 'username' | 'dob' | 'referral';

const USERNAME_RE = /^[A-Za-z0-9_-]{3,30}$/;
const MIN_AGE = 13;

export function OnboardingScreen() {
  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [referral, setReferral] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Debounced availability check, same as the Android field. */
  useEffect(() => {
    const value = username.trim();
    setAvailable(null);
    if (!USERNAME_RE.test(value)) return;
    let alive = true;
    setChecking(true);
    const id = window.setTimeout(async () => {
      try {
        const res = await auth.checkUsername(value);
        if (alive) setAvailable(res.available);
      } catch {
        if (alive) setAvailable(null);
      } finally {
        if (alive) setChecking(false);
      }
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(id);
      setChecking(false);
    };
  }, [username]);

  function dateOfBirth(): string | null {
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    if (!d || !m || !y) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date.toISOString().slice(0, 10);
  }

  function age(iso: string): number {
    const dob = new Date(iso);
    const now = new Date();
    let years = now.getUTCFullYear() - dob.getUTCFullYear();
    const before =
      now.getUTCMonth() < dob.getUTCMonth() ||
      (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
    if (before) years -= 1;
    return years;
  }

  function nextFromUsername() {
    const value = username.trim();
    if (!USERNAME_RE.test(value)) {
      setError(t('create_account_username_error_invalid'));
      return;
    }
    if (available === false) {
      setError(t('create_account_username_error_taken'));
      return;
    }
    setError(null);
    setStep('dob');
  }

  function nextFromDob() {
    const iso = dateOfBirth();
    if (!iso) {
      setError(t('create_account_dob_error_invalid'));
      return;
    }
    if (age(iso) < MIN_AGE) {
      setError(t('create_account_dob_error_too_young', MIN_AGE));
      return;
    }
    setError(null);
    setStep('referral');
  }

  async function finish() {
    const iso = dateOfBirth();
    setBusy(true);
    setError(null);
    try {
      await auth.completeOnboarding({
        username: username.trim(),
        dateOfBirth: iso,
        referralCode: referral.trim(),
        // Nanotag defaults; the profile editor can change them later.
        nanotag: { colorPreset: 'green', chaosPercentage: 50 },
      });
      await loadMe();
    } catch (e) {
      setError(
        isApiError(e) ? apiErrorText(e.code, e.message) : errorMessage(e, t('auth_error_network')),
      );
      setBusy(false);
    }
  }

  return (
    <div class="login">
      <div class="login-card">
        <Icon name="ic_nano_logo" size={56} className="login-logo" />

        {step === 'username' && (
          <>
            <h1 class="login-title">{t('create_account_username_title')}</h1>
            <p class="login-sub">{t('create_account_username_subtitle')}</p>
            <input
              class="input"
              autoFocus
              placeholder={t('create_account_username_placeholder')}
              value={username}
              maxLength={30}
              onInput={(e) => {
                setUsername((e.target as HTMLInputElement).value);
                setError(null);
              }}
            />
            <div class="hstack" style={{ justifyContent: 'center', minHeight: 20 }}>
              {checking && <Spinner size={14} />}
              {available === true && (
                <span class="small" style={{ color: 'var(--brand)' }}>
                  <Icon name="ic_streamline_check" size={13} /> Available
                </span>
              )}
              {available === false && (
                <span class="small" style={{ color: 'var(--danger)' }}>
                  {t('create_account_username_error_taken')}
                </span>
              )}
            </div>
            {error && <p class="field-error">{error}</p>}
            <Button full onClick={nextFromUsername} disabled={checking}>
              {t('onboarding_continue')}
            </Button>
          </>
        )}

        {step === 'dob' && (
          <>
            <h1 class="login-title">{t('create_account_dob_title')}</h1>
            <p class="login-sub">{t('create_account_dob_subtitle')}</p>
            <div class="hstack">
              <input
                class="input"
                placeholder="DD"
                inputMode="numeric"
                maxLength={2}
                value={day}
                onInput={(e) => setDay((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
              />
              <input
                class="input"
                placeholder="MM"
                inputMode="numeric"
                maxLength={2}
                value={month}
                onInput={(e) => setMonth((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
              />
              <input
                class="input"
                placeholder="YYYY"
                inputMode="numeric"
                maxLength={4}
                value={year}
                onInput={(e) => setYear((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
              />
            </div>
            {error && <p class="field-error">{error}</p>}
            <Button full onClick={nextFromDob}>
              {t('onboarding_continue')}
            </Button>
            <Button full variant="ghost" onClick={() => setStep('username')}>
              Back
            </Button>
          </>
        )}

        {step === 'referral' && (
          <>
            <h1 class="login-title">{t('create_account_referral_title')}</h1>
            <p class="login-sub">{t('create_account_referral_subtitle')}</p>
            <input
              class="input"
              placeholder={t('create_account_referral_placeholder')}
              value={referral}
              maxLength={32}
              onInput={(e) => setReferral((e.target as HTMLInputElement).value)}
            />
            {error && <p class="field-error">{error}</p>}
            <Button full onClick={() => void finish()} loading={busy}>
              {referral.trim()
                ? t('create_account_referral_next')
                : t('create_account_referral_next_skip')}
            </Button>
          </>
        )}

        <Button
          full
          variant="ghost"
          onClick={() => {
            void signOut();
            toast(t('onboarding_log_out'));
          }}
        >
          {t('onboarding_log_out')}
        </Button>
      </div>
    </div>
  );
}
