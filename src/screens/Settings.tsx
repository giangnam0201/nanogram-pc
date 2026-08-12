import { useState } from 'preact/hooks';
import { misc, profile as api } from '../lib/api';
import { errorMessage, ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back, loadMe, me, signOut, toast } from '../lib/store';
import { Avatar, Button, Sheet } from '../components/common';
import { Icon } from '../components/Icon';

export function SettingsScreen() {
  const user = me.value;
  const [renameOpen, setRenameOpen] = useState(false);
  const [username, setUsername] = useState(user?.username ?? '');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveUsername() {
    const value = username.trim();
    if (!value) return;
    setBusy(true);
    try {
      await api.patchMe({ username: value });
      await loadMe();
      setRenameOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback() {
    const text = feedback.trim();
    if (!text) return;
    setBusy(true);
    try {
      await misc.feedback(text);
      setFeedback('');
      setFeedbackOpen(false);
      toast(t('feedback_thanks'));
    } catch (e) {
      toast(errorMessage(e, t('feedback_error')), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <h1 class="screen-title">{t('profile_settings')}</h1>
      </div>

      <div class="screen-pad" style={{ maxWidth: 620 }}>
        <div class="row" style={{ pointerEvents: 'none' }}>
          <Avatar url={user?.avatarUrl} name={user?.username} size={56} />
          <div class="row-main">
            <div class="row-title">@{user?.username}</div>
            <div class="row-sub">{user?.email ?? user?.pendingEmail ?? ''}</div>
          </div>
        </div>

        <h2 class="section-title">Account</h2>
        <div class="list">
          <button class="row" onClick={() => setRenameOpen(true)}>
            <Icon name="ic_settings_person" size={19} />
            <div class="row-main">
              <div class="row-title">Username</div>
              <div class="row-sub">@{user?.username}</div>
            </div>
          </button>

          <div class="row">
            <Icon name="ic_settings_envelope" size={19} />
            <div class="row-main">
              <div class="row-title">Email</div>
              <div class="row-sub">{user?.email ?? 'Not linked'}</div>
            </div>
          </div>

          <div class="row">
            <Icon name="ic_settings_calendar" size={19} />
            <div class="row-main">
              <div class="row-title">Date of birth</div>
              <div class="row-sub">{user?.dateOfBirth ?? '—'}</div>
            </div>
          </div>

          <div class="row">
            <Icon name="ic_settings_shield" size={19} />
            <div class="row-main">
              <div class="row-title">Parental controls</div>
              <div class="row-sub">
                {user?.parentalControls?.enabled ? 'On' : 'Off'}
              </div>
            </div>
          </div>

          {user?.referralCode && (
            <button
              class="row"
              onClick={() => {
                void navigator.clipboard.writeText(user.referralCode ?? '');
                toast(t('share_copy_link'));
              }}
            >
              <Icon name="ic_card_giftcard" size={19} />
              <div class="row-main">
                <div class="row-title">Referral code</div>
                <div class="row-sub">{user.referralCode}</div>
              </div>
              <Icon name="ic_content_copy" size={16} />
            </button>
          )}
        </div>

        <h2 class="section-title">About</h2>
        <div class="list">
          <button class="row" onClick={() => setFeedbackOpen(true)}>
            <Icon name="ic_generate_insight" size={19} />
            <div class="row-main">
              <div class="row-title">{t('feedback_title')}</div>
            </div>
          </button>

          <button class="row" onClick={() => void ipc.openExternal(t('welcome_terms_url'))}>
            <Icon name="ic_settings_lock" size={19} />
            <div class="row-main">
              <div class="row-title">{t('welcome_policy_terms')}</div>
            </div>
          </button>

          <button class="row" onClick={() => void ipc.openExternal(t('welcome_privacy_url'))}>
            <Icon name="ic_settings_shield" size={19} />
            <div class="row-main">
              <div class="row-title">{t('welcome_policy_privacy')}</div>
            </div>
          </button>
        </div>

        <div style={{ marginTop: 28 }}>
          <Button full variant="danger" onClick={() => void signOut()}>
            <Icon name="ic_logout" size={16} />
            {t('onboarding_log_out')}
          </Button>
        </div>
      </div>

      {renameOpen && (
        <Sheet title="Username" onClose={() => setRenameOpen(false)}>
          <div class="stack">
            <input
              class="input"
              value={username}
              maxLength={30}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            />
            <p class="field-hint">{t('create_account_username_error_invalid')}</p>
            <Button full onClick={() => void saveUsername()} loading={busy}>
              Save
            </Button>
          </div>
        </Sheet>
      )}

      {feedbackOpen && (
        <Sheet title={t('feedback_title')} onClose={() => setFeedbackOpen(false)}>
          <div class="stack">
            <textarea
              class="textarea"
              placeholder={t('feedback_placeholder')}
              value={feedback}
              maxLength={1000}
              onInput={(e) => setFeedback((e.target as HTMLTextAreaElement).value)}
            />
            <Button full onClick={() => void sendFeedback()} loading={busy} disabled={!feedback.trim()}>
              {t('feedback_submit')}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
