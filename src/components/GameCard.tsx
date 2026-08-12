import { Icon } from './Icon';
import { formatCount } from './common';
import { t } from '../lib/i18n';

export interface CardGame {
  id: string;
  title?: string | null;
  thumbnailUrl?: string | null;
  gameUrl?: string | null;
  username?: string | null;
  likes?: number | null;
  remixCount?: number | null;
}

export function GameCard({
  game,
  onOpen,
  badge,
}: {
  game: CardGame;
  onOpen: (game: CardGame) => void;
  badge?: string | null;
}) {
  const subtitle =
    game.remixCount != null
      ? t('discover_list_row_subtitle_remixes', game.username ?? '', formatCount(game.remixCount))
      : t('discover_list_row_subtitle', game.username ?? '', formatCount(game.likes));

  return (
    <button class="card" onClick={() => onOpen(game)}>
      <div class="card-thumb">
        {game.thumbnailUrl ? (
          <img src={game.thumbnailUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div class="center-fill">
            <Icon name="ic_gameboy" size={30} />
          </div>
        )}
        {badge && <span class="card-badge">{badge}</span>}
      </div>
      <div class="card-title">{game.title ?? 'Untitled'}</div>
      {game.username && <div class="card-sub truncate">{subtitle}</div>}
    </button>
  );
}
