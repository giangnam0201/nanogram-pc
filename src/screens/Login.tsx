import { useEffect, useRef, useState } from 'preact/hooks';
import { auth } from '../lib/api';
import { errorMessage, ipc, isApiError } from '../lib/ipc';
import { apiErrorText, t } from '../lib/i18n';
import { refreshSession, toast } from '../lib/store';
import { Button, Spinner } from '../components/common';
import { Icon } from '../components/Icon';

type Step = 'welcome' | 'email' | 'code';

const RESEND_SECONDS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen() {
  const [step, setStep] = useState<Step>('welcome');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  function fail(e: unknown, fallback: string) {
    setError(isApiError(e) ? apiErrorText(e.code, e.message || fallback) : errorMessage(e, fallback));
  }

  async function sendCode(isResend = false) {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setError(t('auth_error_invalid_email'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.requestEmailOtp(value);
      setEmail(value);
      setStep('code');
      setResendIn(RESEND_SECONDS);
      if (isResend) toast(t('auth_otp_resend'));
    } catch (e) {
      fail(e, t('auth_error_network'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const value = code.replace(/\D/g, '');
    if (value.length !== 6) {
      setError(t('auth_otp_error_invalid_code'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.verifyEmailOtp(email, value);
      await refreshSession();
    } catch (e) {
      fail(e, t('auth_otp_error_invalid_code'));
      setBusy(false);
    }
  }

  async function oauth(provider: 'google' | 'discord') {
    setBusy(true);
    setError(null);
    try {
      await (provider === 'google' ? ipc.loginGoogle() : ipc.loginDiscord());
      await refreshSession();
    } catch (e) {
      fail(e, t('auth_error_authentication'));
      setBusy(false);
    }
  }

  return (
    <div class="login">
      <div class="login-card">
        <Icon name="ic_nano_logo" size={64} className="login-logo" />

        {step === 'welcome' && (
          <>
            <h1 class="login-title">Nanogram</h1>
            <p class="login-sub">Play, create and remix instant games.</p>

            <Button full onClick={() => setStep('email')} disabled={busy}>
              {t('welcome_continue_with_email')}
            </Button>

            <div class="divider">or</div>

            <Button full variant="outline" onClick={() => void oauth('google')} loading={busy}>
              <Icon name="ic_google" size={18} />
              {t('login_continue_with_google')}
            </Button>
            <Button full variant="outline" onClick={() => void oauth('discord')} disabled={busy}>
              <Icon name="ic_discord" size={18} />
              {t('login_continue_with_discord')}
            </Button>

            {error && <p class="field-error">{error}</p>}

            <p class="small muted" style={{ marginTop: 12 }}>
              By continuing you agree to our{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void ipc.openExternal(t('welcome_terms_url'));
                }}
              >
                <u>{t('welcome_policy_terms')}</u>
              </a>{' '}
              and{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void ipc.openExternal(t('welcome_privacy_url'));
                }}
              >
                <u>{t('welcome_policy_privacy')}</u>
              </a>
              .
            </p>
          </>
        )}

        {step === 'email' && (
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <h1 class="login-title">{t('auth_otp_email_title')}</h1>
            <p class="login-sub">{t('auth_otp_email_subtitle')}</p>
            <input
              class="input"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder={t('auth_otp_email_placeholder')}
              value={email}
              onInput={(e) => {
                setEmail((e.target as HTMLInputElement).value);
                setError(null);
              }}
            />
            {error && <p class="field-error">{error}</p>}
            <Button full type="submit" loading={busy}>
              {t('auth_otp_email_next')}
            </Button>
            <Button full variant="ghost" onClick={() => setStep('welcome')} disabled={busy}>
              Back
            </Button>
          </form>
        )}

        {step === 'code' && (
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <h1 class="login-title">{t('auth_otp_code_title')}</h1>
            <p class="login-sub">{t('auth_otp_code_subtitle', email)}</p>
            <input
              ref={codeRef}
              class="input otp-input"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder={t('auth_otp_code_placeholder')}
              value={code}
              onInput={(e) => {
                const next = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                setError(null);
                if (next.length === 6) void verify();
              }}
            />
            {error && <p class="field-error">{error}</p>}
            <Button full type="submit" loading={busy}>
              {t('auth_otp_code_next')}
            </Button>
            <button
              class="btn btn-ghost btn-full"
              type="button"
              disabled={resendIn > 0 || busy}
              onClick={() => void sendCode(true)}
            >
              {resendIn > 0 ? t('auth_otp_resend_in', resendIn) : t('auth_otp_resend')}
            </button>
            <button
              class="btn btn-ghost btn-full"
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
              disabled={busy}
            >
              Change email
            </button>
          </form>
        )}

        {busy && step === 'welcome' && (
          <div class="hstack" style={{ justifyContent: 'center' }}>
            <Spinner size={16} />
            <span class="small muted">Waiting for sign-in…</span>
          </div>
        )}
      </div>
    </div>
  );
}
