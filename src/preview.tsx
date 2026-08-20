/* Throwaway visual harness for the Multi-Creator UI.
   The real screens sit behind a Nanogram login, so this renders the same
   markup and components against fixed data to check layout and theming.
   Not part of the app or the build — delete once reviewed. */

import { render } from 'preact';
import './styles/theme.css';
import './styles/app.css';
import './styles/rooms.css';
import { BuildStage } from './components/BuildStage';
import { Icon } from './components/Icon';
import { Avatar } from './components/common';

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 class="section-title">{title}</h2>
      {children}
    </div>
  );
}

function Harness() {
  return (
    <div class="screen" style={{ overflowY: 'auto', height: '100%' }}>
      <div class="screen-head">
        <h1 class="screen-title">Multi-Creator</h1>
        <span class="spacer" />
        <button class="chip">
          <Icon name="ic_credit_card" size={15} />
          <span style={{ marginLeft: 6 }}>42 credits</span>
        </button>
      </div>

      <div class="screen-pad">
        <Section title="Build stage — full">
          <BuildStage
            startedAt={Date.now() - 73_000}
            requestedBy="mira"
            prompt="make the enemies chase the player and add a score counter"
          />
        </Section>

        <Section title="Build stage — compact (in chat)">
          <BuildStage startedAt={Date.now() - 8_000} requestedBy="nam" prompt="add a jump" compact />
        </Section>

        <Section title="Storage warning">
          <div class="notice notice-warn">
            <Icon name="ic_report_flag" size={15} />
            <span>
              Rooms are being kept in memory because no Redis is configured. Fine for local testing
              — they will not survive on a real deployment.
            </span>
          </div>
        </Section>

        <Section title="Room actions">
          <div class="room-actions">
            <button class="room-new">
              <span class="room-new-plus">
                <Icon name="ic_pill_plus" size={22} />
              </span>
              <span class="room-new-copy">
                <strong>New room</strong>
                <span class="muted small">Build a game with friends, live</span>
              </span>
            </button>
            <button class="room-join">
              <Icon name="ic_group_add" size={18} />
              <span>Join with a code</span>
            </button>
          </div>
        </Section>

        <Section title="Room rows">
          <div class="list">
            <button class="row room-row">
              <div class="room-avatars">
                <span class="room-av is-online">
                  <Avatar name="nam" size={28} />
                </span>
                <span class="room-av is-online">
                  <Avatar name="mira" size={28} />
                </span>
                <span class="room-av">
                  <Avatar name="tuan" size={28} />
                </span>
              </div>
              <div class="row-main">
                <div class="row-title truncate">Saturday game jam</div>
                <div class="row-sub">
                  <span class="room-live">
                    <span class="room-dot" />2 online
                  </span>
                  <span class="muted"> · 3m</span>
                </div>
              </div>
              <span class="chip chip-quiet">
                <Icon name="ic_auto_awesome" size={13} />
              </span>
              <Icon name="ic_chevron_left" size={16} />
            </button>

            <button class="row room-row">
              <div class="room-avatars">
                <span class="room-av">
                  <Avatar name="kai" size={28} />
                </span>
              </div>
              <div class="row-main">
                <div class="row-title truncate">Dungeon crawler idea</div>
                <div class="row-sub">
                  <span>1 member</span>
                  <span class="muted"> · 2d</span>
                </div>
              </div>
              <Icon name="ic_chevron_left" size={16} />
            </button>
          </div>
        </Section>

        <Section title="Chat log pieces">
          <div class="chat-log" style={{ background: 'var(--surface)', borderRadius: 12 }}>
            <div class="room-note">
              <span>@mira joined</span>
              <span class="muted"> · 5m</span>
            </div>
            <div class="bubble bubble-in">
              <span class="bubble-who">@mira</span>
              ok what are we making
            </div>
            <div class="bubble bubble-out">a game where you dodge asteroids</div>
            <div class="room-note room-note-prompt">
              <Icon name="ic_auto_awesome" size={13} />
              <span>
                <strong>@nam</strong> asked for “add asteroids that speed up over time”
              </span>
            </div>
            <div class="room-note">
              <span>New build from @nam</span>
              <span class="muted"> · now</span>
            </div>
          </div>
        </Section>

        <Section title="Composer">
          <div class="room-composer" style={{ borderRadius: 12, border: '1px solid var(--line)' }}>
            <div class="room-mode">
              <button class="room-mode-btn">Say</button>
              <button class="room-mode-btn is-active">
                <Icon name="ic_auto_awesome" size={13} />
                Build
              </button>
              <span class="room-quota">7 left</span>
            </div>
            <form class="composer" onSubmit={(e) => e.preventDefault()}>
              <input class="input" placeholder="Describe a change to the game…" />
              <button class="btn btn-primary" type="button">
                <Icon name="ic_streamline_arrow_up_right" size={16} />
              </button>
            </form>
            <p class="room-hint">
              Only @nam can build here right now — and they are offline. They can turn on “keep
              building while I’m away” in room settings.
            </p>
          </div>
        </Section>

        <Section title="Invite">
          <div class="stack">
            <div class="invite-code">
              <span>K7M2QP</span>
              <Icon name="ic_content_copy" size={16} />
            </div>
            <button class="invite-link">
              <Icon name="ic_share_link" size={16} />
              <span class="truncate">https://nanogram-pc.vercel.app/?join=K7M2QP</span>
            </button>
          </div>
        </Section>

        <Section title="Style strip">
          <div class="style-strip">
            {['Pixel', 'Neon', 'Clay', 'Hand-drawn', 'Low-poly'].map((name) => (
              <button key={name} class={`style-pill${name === 'Neon' ? ' is-active' : ''}`}>
                <span
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    borderRadius: 8,
                    background: 'var(--surface-3)',
                  }}
                />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Empty game pane">
          <div class="room-preview" style={{ height: 220, borderRadius: 12, display: 'grid' }}>
            <div class="room-empty-game">
              <Icon name="ic_gameboy" size={34} />
              <p class="muted small">
                Nothing built yet. Switch the composer to <strong>Build</strong> and describe the
                game you want.
              </p>
            </div>
          </div>
        </Section>
      </div>

      <nav class="navbar" aria-label="Main">
        {[
          ['ic_navbar_home', 'Home'],
          ['ic_navbar_search', 'Discover'],
          ['ic_navbar_create', 'Create'],
          ['ic_group_add', 'Rooms'],
          ['ic_navbar_inbox', 'Inbox'],
          ['ic_navbar_profile', 'Profile'],
        ].map(([icon, label]) => (
          <button key={label} class={`nav-item${label === 'Rooms' ? ' is-active' : ''}`}>
            <span class="nav-icon">
              <Icon name={icon} size={label === 'Create' ? 26 : 22} />
            </span>
            <span class="nav-label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

render(<Harness />, document.getElementById('root')!);
