import { useEffect, useState } from 'preact/hooks';

/* The welcome carousel from the Android app, using its own artwork. Each card
   is layered — a painted background with foreground pieces on top — so the
   scene keeps a little depth as cards rotate. */

const art = import.meta.glob('../assets/img/welcome_card_*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function src(name: string): string | undefined {
  const hit = Object.entries(art).find(([path]) => path.endsWith(`/${name}.webp`));
  return hit?.[1];
}

interface Card {
  key: string;
  label: string;
  layers: string[];
}

const CARDS: Card[] = [
  {
    key: 'endless',
    label: 'Endless runners',
    layers: ['welcome_card_endless_bg', 'welcome_card_endless_fg'],
  },
  {
    key: 'jungle',
    label: 'Adventures',
    layers: ['welcome_card_jungle_bg', 'welcome_card_jungle_fg'],
  },
  {
    key: 'platformer',
    label: 'Platformers',
    layers: ['welcome_card_platformer_bg', 'welcome_card_platformer_fg'],
  },
  {
    key: 'puzzle',
    label: 'Puzzles',
    layers: ['welcome_card_puzzle_bg', 'welcome_card_puzzle_fg'],
  },
  {
    key: 'racing',
    label: 'Racing',
    layers: [
      'welcome_card_racing_bg',
      'welcome_card_racing_rider_left',
      'welcome_card_racing_rider_right',
    ],
  },
  {
    key: 'tower_defense',
    label: 'Tower defence',
    layers: [
      'welcome_card_tower_defense_bg',
      'welcome_card_tower_defense_fg',
      'welcome_card_td_flag_upper_left',
      'welcome_card_td_flag_left',
      'welcome_card_td_flag_top',
      'welcome_card_td_flag_right',
    ],
  },
];

const ROTATE_MS = 4000;

export function WelcomeCards() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % CARDS.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div class="welcome-art">
      <div class="welcome-deck">
        {CARDS.map((card, i) => {
          // Show the current card plus the next two, fanned behind it.
          const offset = (i - index + CARDS.length) % CARDS.length;
          const visible = offset < 3;
          return (
            <figure
              key={card.key}
              class="welcome-card"
              data-offset={offset}
              style={{
                opacity: visible ? 1 : 0,
                transform: `translateY(${offset * 18}px) scale(${1 - offset * 0.06}) rotate(${
                  offset === 0 ? 0 : offset % 2 ? 3 : -3
                }deg)`,
                zIndex: CARDS.length - offset,
                pointerEvents: offset === 0 ? 'auto' : 'none',
              }}
            >
              {card.layers.map((layer, depth) => (
                <img
                  key={layer}
                  src={src(layer)}
                  alt=""
                  class={depth === 0 ? 'welcome-layer welcome-layer-bg' : 'welcome-layer'}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              ))}
              <figcaption class="welcome-card-label ng-label-sm">{card.label}</figcaption>
            </figure>
          );
        })}
      </div>

      <div class="welcome-dots" role="tablist" aria-label="Categories">
        {CARDS.map((card, i) => (
          <button
            key={card.key}
            class={`welcome-dot${i === index ? ' is-active' : ''}`}
            onClick={() => setIndex(i)}
            role="tab"
            aria-selected={i === index}
            aria-label={card.label}
          />
        ))}
      </div>
    </div>
  );
}
