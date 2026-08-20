import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { Avatar } from './common';
import { t } from '../lib/i18n';

/* The wait while a game generates.
 *
 * Nanogram's API reports no progress, no ETA and no queue position — the only
 * signal is "still running". So there is deliberately no progress bar here: a
 * percentage would be invented, and a bar that stalls at 80% reads as broken.
 * Instead: motion that never claims to measure anything, an honest elapsed
 * counter, and copy that changes often enough to be worth watching.
 *
 * In a room this is shared furniture — everyone sees the same stage, the same
 * timer and who asked for the build, and chat keeps working underneath.
 */

/** Rotating flavour. Kept playful but never dishonest about what is happening. */
const LINES = [
  'Sketching the first screen…',
  'Teaching the enemies to be mean…',
  'Deciding how gravity should feel…',
  'Naming things. This is the hard part…',
  'Hiding a secret in the corner…',
  'Arguing about the colour palette…',
  'Tuning the jump until it feels right…',
  'Adding one more thing that probably breaks it…',
  'Playtesting against itself…',
  'Making the score go up satisfyingly…',
];

const LINE_MS = 3800;

function elapsedLabel(secs: number): string {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

export function BuildStage({
  startedAt,
  requestedBy,
  requestedByAvatar,
  prompt,
  compact,
}: {
  /** Epoch ms the build began, so the timer survives a remount or a rejoin. */
  startedAt: number;
  requestedBy?: string | null;
  requestedByAvatar?: string | null;
  prompt?: string | null;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [line, setLine] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setLine((n) => (n + 1) % LINES.length), LINE_MS);
    return () => window.clearInterval(id);
  }, []);

  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div class={`build-stage${compact ? ' is-compact' : ''}`} role="status" aria-live="polite">
      <div class="build-aurora" aria-hidden="true">
        <span class="build-aurora-spin" />
        <span class="build-cartridge">
          <Icon name="ic_gameboy" size={compact ? 22 : 30} />
        </span>
      </div>

      <div class="build-copy">
        <strong class="build-title">{t('remix_building_title')}</strong>
        <span class="build-line">{LINES[line]}</span>

        <div class="build-meta">
          <span class="build-timer" title="Time since this build started">
            <Icon name="ic_local_fire_department" size={12} />
            {elapsedLabel(secs)}
          </span>
          {requestedBy && (
            <span class="build-asker">
              <Avatar url={requestedByAvatar} name={requestedBy} size={16} />
              @{requestedBy} asked for this
            </span>
          )}
        </div>

        {prompt && !compact && <p class="build-prompt">“{prompt}”</p>}

        {/* Sets expectations honestly once it is clearly not a quick one. */}
        {secs > 45 && (
          <p class="build-patience">
            {t('remix_building_notify')} You can keep chatting while this runs.
          </p>
        )}
      </div>
    </div>
  );
}
