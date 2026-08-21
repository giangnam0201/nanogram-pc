import { useEffect, useState } from 'preact/hooks';
import { gamegen } from '../lib/api';
import { errorMessage } from '../lib/ipc';
import { t } from '../lib/i18n';
import { cdnUrl } from '../lib/cdn';
import { navigate, toast } from '../lib/store';
import {
  localRefreshToken,
  rooms as roomsApi,
  roomsAvailable,
  type RoomSummary,
} from '../lib/rooms';
import { Avatar, Button, EmptyState, Sheet, Spinner, formatCount, timeAgo } from '../components/common';
import { Icon } from '../components/Icon';
import type { Credits, GameGenStyle } from '../lib/types';

/* Multi-Creator: build a game with other people in the same room.
 *
 * Rooms are our own construct. Nanogram's chat API is strictly one-to-one and
 * it has no realtime transport at all, so a shared room cannot be expressed in
 * their API — but the game being built, the credits being spent and everyone's
 * identity are all genuinely Nanogram's. */

export function MultiCreatorScreen() {
  const [list, setList] = useState<RoomSummary[] | null>(null);
  const [storage, setStorage] = useState<'supabase' | 'memory'>('supabase');
  const [credits, setCredits] = useState<Credits | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  async function load() {
    try {
      const res = await roomsApi.list();
      setList(res.rooms);
      setStorage(res.storage);
    } catch (e) {
      toast(errorMessage(e, "Couldn't load your rooms."), 'error');
      setList([]);
    }
  }

  useEffect(() => {
    if (!roomsAvailable) {
      setList([]);
      return;
    }
    void load();
    void gamegen.credits().then(setCredits).catch(() => {});
  }, []);

  if (!roomsAvailable) {
    return (
      <div class="screen">
        <div class="screen-head">
          <h1 class="screen-title">Multi-Creator</h1>
        </div>
        <div class="screen-pad">
          <EmptyState
            icon="ic_group_add"
            text="Multi-Creator runs on the web app, where the room server lives. Open Nanogram in a browser to build with friends."
          />
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      <div class="screen-head">
        <h1 class="screen-title">Multi-Creator</h1>
        <span class="spacer" />
        {credits && (
          <button class="chip" onClick={() => navigate({ name: 'credits' })}>
            <Icon name="ic_credit_card" size={15} />
            <span style={{ marginLeft: 6 }}>
              {formatCount(Math.floor((credits.remainingToday ?? 0) + (credits.bankBalance ?? 0)))}{' '}
              {t('profile_credits')}
            </span>
          </button>
        )}
      </div>

      <div class="screen-pad">
        {storage === 'memory' && (
          <div class="notice notice-warn">
            <Icon name="ic_report_flag" size={15} />
            <span>
              Rooms are being kept in memory because Supabase is not configured. Fine for
              local testing — they will not survive on a real deployment.
            </span>
          </div>
        )}

        <div class="room-actions">
          <button class="room-new" onClick={() => setCreateOpen(true)}>
            <span class="room-new-plus">
              <Icon name="ic_pill_plus" size={22} />
            </span>
            <span class="room-new-copy">
              <strong>New room</strong>
              <span class="muted small">Build a game with friends, live</span>
            </span>
          </button>
          <button class="room-join" onClick={() => setJoinOpen(true)}>
            <Icon name="ic_group_add" size={18} />
            <span>Join with a code</span>
          </button>
        </div>

        <h2 class="section-title">Your rooms</h2>

        {list === null && <Spinner size={20} />}
        {list?.length === 0 && (
          <EmptyState icon="ic_person_2" text="No rooms yet. Make one and share the link." />
        )}

        <div class="list">
          {list?.map((room) => (
            <button
              key={room.id}
              class="row room-row"
              onClick={() => navigate({ name: 'room', roomId: room.id })}
            >
              <div class="room-avatars">
                {room.members.slice(0, 3).map((m) => (
                  <span key={m.id} class={`room-av${m.online ? ' is-online' : ''}`}>
                    <Avatar url={m.avatarUrl} name={m.username} size={28} />
                  </span>
                ))}
              </div>
              <div class="row-main">
                <div class="row-title truncate">{room.title}</div>
                <div class="row-sub">
                  {room.onlineCount > 0 ? (
                    <span class="room-live">
                      <span class="room-dot" />
                      {room.onlineCount} online
                    </span>
                  ) : (
                    <span>{room.memberCount} member{room.memberCount === 1 ? '' : 's'}</span>
                  )}
                  <span class="muted"> · {timeAgo(room.updatedAt)}</span>
                </div>
              </div>
              {room.delegated && (
                <span class="chip chip-quiet" title="Builds run on the owner's credits">
                  <Icon name="ic_auto_awesome" size={13} />
                </span>
              )}
              <Icon name="ic_chevron_left" size={16} />
            </button>
          ))}
        </div>
      </div>

      {createOpen && (
        <CreateRoomSheet
          onClose={() => setCreateOpen(false)}
          onCreated={(room) => {
            setCreateOpen(false);
            navigate({ name: 'room', roomId: room.id });
          }}
        />
      )}

      {joinOpen && (
        <JoinRoomSheet
          onClose={() => setJoinOpen(false)}
          onJoined={(room) => {
            setJoinOpen(false);
            navigate({ name: 'room', roomId: room.id });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- create --- */

function CreateRoomSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (room: RoomSummary) => void;
}) {
  const [title, setTitle] = useState('');
  const [styles, setStyles] = useState<GameGenStyle[] | null>(null);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [quota, setQuota] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void gamegen
      .styles()
      .then((s) => {
        const all = s.styles ?? [];
        setStyles(all);
        setStyleId((prev) => prev ?? all[0]?.id ?? null);
      })
      .catch(() => setStyles([]));
  }, []);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      /* Link the creator's sign-in before the room exists, not alongside it.
         The room will build on this account, and the app-load link is
         fire-and-forget — so without this a room made moments after opening the
         app can be created before its owner is linked, and quietly falls back
         to every member building in their own session. Nobody would know to go
         and fix that, so it is done here where it cannot be missed. */
      const refreshToken = localRefreshToken();
      if (refreshToken) {
        await roomsApi.linkToken(refreshToken).catch(() => {
          /* Not fatal — the room still works, just on each member's own
             credits. Room settings reports which. */
        });
      }

      const style = styles?.find((s) => s.id === styleId) ?? null;
      const res = await roomsApi.create({
        title: title.trim(),
        styleId,
        dimension: style?.dimension ?? null,
        creditQuota: quota.trim() ? Number(quota) : 0,
      });
      onCreated(res.room);
    } catch (e) {
      toast(errorMessage(e, "Couldn't create the room."), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New room" onClose={onClose}>
      <div class="stack">
        <input
          class="input"
          autoFocus
          placeholder="Room name — e.g. Saturday game jam"
          value={title}
          maxLength={80}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />

        <div>
          <div class="field-label">Style</div>
          {styles === null ? (
            <Spinner size={18} />
          ) : (
            <div class="style-strip">
              {styles.map((s) => (
                <button
                  key={s.id}
                  class={`style-pill${styleId === s.id ? ' is-active' : ''}`}
                  onClick={() => setStyleId(s.id ?? null)}
                >
                  {s.screenshotUrl && <img src={cdnUrl(s.screenshotUrl)} alt="" loading="lazy" />}
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div class="field-label">Credit limit</div>
          <input
            class="input"
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="Leave empty for no limit"
            value={quota}
            onInput={(e) => setQuota((e.target as HTMLInputElement).value)}
          />
          <p class="field-hint">
            The most credits this room may spend in total. Builds stop once it is reached, and you
            can raise it any time.
          </p>
        </div>

        <Button full onClick={() => void create()} loading={busy} disabled={!styleId}>
          <Icon name="ic_group_add" size={16} />
          Create room
        </Button>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- join --- */

function JoinRoomSheet({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (room: RoomSummary) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function join() {
    const value = code.trim().toUpperCase();
    if (!value || busy) return;
    setBusy(true);
    try {
      const res = await roomsApi.join(value);
      onJoined(res.room);
    } catch (e) {
      toast(errorMessage(e, "That code didn't work."), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Join a room" onClose={onClose}>
      <div class="stack">
        <input
          class="input otp-input"
          autoFocus
          placeholder="ABC123"
          value={code}
          maxLength={6}
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
        />
        <p class="field-hint">Ask whoever made the room for its six-character code or link.</p>
        <Button full onClick={() => void join()} loading={busy} disabled={code.trim().length < 6}>
          Join
        </Button>
      </div>
    </Sheet>
  );
}
