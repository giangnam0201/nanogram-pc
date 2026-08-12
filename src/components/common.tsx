import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';
import { t } from '../lib/i18n';

export function Spinner({ size = 24 }: { size?: number }) {
  return <span class="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function FullSpinner() {
  return (
    <div class="center-fill">
      <Spinner size={32} />
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div class="center-fill state">
      <p class="state-text">{text}</p>
      {onRetry && (
        <button class="btn btn-outline" onClick={onRetry}>
          {t('discover_list_retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ text, icon }: { text: string; icon?: string }) {
  return (
    <div class="center-fill state">
      {icon && <Icon name={icon} size={40} />}
      <p class="state-text">{text}</p>
    </div>
  );
}

export function Avatar({
  url,
  name,
  size = 40,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
}) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div class="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span>{initial}</span>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  loading,
  full,
  type = 'button',
}: {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      class={`btn btn-${variant}${full ? ' btn-full' : ''}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <Spinner size={16} /> : children}
    </button>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  wide,
}: {
  title?: string;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return (
    <div
      class="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class={`sheet${wide ? ' sheet-wide' : ''}`} role="dialog" aria-modal="true">
        <header class="sheet-head">
          <h3>{title}</h3>
          <button class="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="ic_pill_close" size={18} />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Compact counts, matching how the Android feed renders them (1.2K, 3.4M). */
export function formatCount(n?: number | null): string {
  const value = n ?? 0;
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}K`;
  }
  const m = value / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return 'now';
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}
