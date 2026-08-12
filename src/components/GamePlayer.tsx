import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { cdnUrl } from '../lib/cdn';
import { Spinner } from './common';

/* Games are plain web bundles served from games.nanogram.app, exactly as on
   Android. They run in a sandboxed frame: same engine as the Android WebView,
   but with no access to the shell's IPC surface. */
export const GAME_SANDBOX =
  'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms allow-orientation-lock';

export function useGameUrl(gameId: string | null, fallback?: string | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!gameId) {
      setUrl(null);
      return;
    }
    if (fallback) {
      setUrl(cdnUrl(fallback) ?? null);
      return;
    }
    void ipc.gameUrl(gameId).then((u) => {
      if (alive) setUrl(cdnUrl(u) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [gameId, fallback]);

  return url;
}

interface FrameProps {
  url: string | null;
  title?: string | null;
  onLoad?: () => void;
}

export function GameFrame({ url, title, onLoad }: FrameProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
  }, [url]);

  if (!url) return <Spinner />;

  return (
    <>
      <iframe
        src={url}
        title={title ?? 'Game'}
        sandbox={GAME_SANDBOX}
        allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
        onLoad={() => {
          setLoading(false);
          onLoad?.();
        }}
      />
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--surface)',
            pointerEvents: 'none',
          }}
        >
          <Spinner size={28} />
        </div>
      )}
    </>
  );
}

/** Full-window player used from cards, search results and profiles. */
export function GamePlayer({
  gameId,
  title,
  gameUrl,
  onClose,
}: {
  gameId: string;
  title?: string | null;
  gameUrl?: string | null;
  onClose: () => void;
}) {
  const url = useGameUrl(gameId, gameUrl);
  // Fill the window by default: most games size themselves to the viewport and
  // look cramped or clipped inside a phone-shaped column on desktop.
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'f' || e.key === 'F') setPortrait((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div class="player">
      <div class="player-bar">
        <button class="icon-btn" onClick={onClose} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>
        <strong class="truncate">{title ?? t('discover_quick_play')}</strong>
        <span class="spacer" />
        <button
          class="icon-btn"
          onClick={() => setPortrait(!portrait)}
          aria-label={portrait ? 'Fill window (F)' : 'Phone size (F)'}
          title={portrait ? 'Fill window (F)' : 'Phone size (F)'}
        >
          <Icon name={portrait ? 'ic_maximize' : 'ic_streamline_landscape'} size={18} />
        </button>
      </div>
      <div class={`player-stage${portrait ? ' is-portrait' : ''}`}>
        <GameFrame url={url} title={title} />
      </div>
    </div>
  );
}
