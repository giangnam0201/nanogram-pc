import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { chat as chatApi, gamegen } from '../lib/api';
import { errorMessage, ipc } from '../lib/ipc';
import { t } from '../lib/i18n';
import { back, me, navigate, toast } from '../lib/store';
import {
  localRefreshToken,
  rooms as roomsApi,
  streamRoom,
  type RoomEvent,
  type RoomMember,
  type RoomState,
} from '../lib/rooms';
import { Avatar, Button, FullSpinner, Sheet, Spinner, timeAgo } from '../components/common';
import { BuildStage } from '../components/BuildStage';
import { Icon } from '../components/Icon';
import { GAME_SANDBOX } from '../components/GamePlayer';
import type { FriendUser } from '../lib/types';

/* A room: shared chat, a shared build, and a shared preview.
 *
 * Two ways a build can run (see api/room.ts):
 *   local   the host's own browser drives GameGen and posts the result back
 *   server  delegation is armed, so anyone can build and the host can be away
 *
 * On a phone the chat and the preview cannot both be on screen, so they become
 * two panes; on a wide window they sit side by side. */

/** Poll tight at first, then back off — most steps finish early, and the ones
 *  that don't should not be hammered for minutes. */
const BACKOFF = [400, 700, 1200, 2000, 3000];

function nextDelay(attempt: number): number {
  return BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
}

type Pane = 'chat' | 'game';

interface BuildInfo {
  startedAt: number;
  by: string;
  avatar?: string | null;
  prompt: string;
}

/* A host who closes the tab mid-build leaves no completion event behind, so
   without a ceiling everyone else would sit on the stage forever. */
const ABANDONED_MS = 10 * 60_000;

/**
 * Whether a build is still running, reconstructed from the event log.
 *
 * Client state does not survive a reload, and someone who joins mid-build never
 * saw the build-start frame at all. Both still have to see the stage, so it is
 * derived from history rather than only from the live stream.
 */
function inFlightBuild(events: RoomEvent[]): BuildInfo | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'snapshot' || event.type === 'build-failed') return null;
    if (event.type === 'build-start') {
      const startedAt = Date.parse(event.at) || Date.now();
      if (Date.now() - startedAt > ABANDONED_MS) return null;
      return {
        startedAt,
        by: event.actorName,
        avatar: event.actorAvatar,
        prompt: event.text ?? '',
      };
    }
  }
  return null;
}

export function RoomScreen({ roomId }: { roomId: string }) {
  const [state, setState] = useState<RoomState | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [status, setStatus] = useState<'live' | 'reconnecting' | 'offline'>('reconnecting');
  const [html, setHtml] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'say' | 'build'>('say');
  const [sending, setSending] = useState(false);
  const [build, setBuild] = useState<BuildInfo | null>(null);

  const [pane, setPane] = useState<Pane>('chat');
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const htmlVersionRef = useRef(-1);

  /* loadMe() swallows a failed /v2/me, so the app can be signed in with
     me.value still null. Comparing against an undefined id then makes the host
     look like a guest, and they get told that they themselves cannot build
     here. Treat identity as unknown rather than guessing. */
  const identityKnown = Boolean(me.value?.id);
  const isHost = identityKnown && state?.room.hostId === me.value?.id;

  /* ------------------------------------------------------------ loading --- */

  const pullHtml = useCallback(async () => {
    try {
      const fresh = await roomsApi.get(roomId, { html: true });
      if (fresh.html) setHtml(fresh.html);
      htmlVersionRef.current = fresh.room.htmlVersion;
    } catch {
      /* the preview is not worth a toast; chat still works */
    }
  }, [roomId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const initial = await roomsApi.get(roomId, { html: true });
        if (!alive) return;
        setState(initial);
        setEvents(initial.events);
        setMembers(initial.members);
        setHtml(initial.html ?? null);
        // Reopening the page, or arriving late, must still show a running build.
        setBuild(inFlightBuild(initial.events));
        seqRef.current = initial.seq;
        htmlVersionRef.current = initial.room.htmlVersion;
      } catch (e) {
        toast(errorMessage(e, "Couldn't open that room."), 'error');
        back();
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomId]);

  /* ------------------------------------------------------------- stream --- */

  useEffect(() => {
    if (!state || !me.value?.id) return;
    const stop = streamRoom(roomId, {
      // Read at call time: the cursor moves while we are connected, and a
      // resync after a dropped socket must start from where we actually got to.
      since: () => seqRef.current,
      me: {
        id: me.value.id,
        username: me.value.username ?? 'someone',
        avatarUrl: me.value.avatarUrl ?? null,
        isHost: state.room.hostId === me.value.id,
      },
      onEvent(event) {
        seqRef.current = Math.max(seqRef.current, event.seq);
        // A resync replays from the cursor while live inserts keep arriving, so
        // the same event can show up twice and out of order. Sequence numbers
        // make both harmless.
        setEvents((prev) =>
          prev.some((e) => e.seq === event.seq)
            ? prev
            : [...prev, event].sort((a, b) => a.seq - b.seq),
        );

        if (event.type === 'build-start') {
          setBuild({
            startedAt: Date.parse(event.at) || Date.now(),
            by: event.actorName,
            avatar: event.actorAvatar,
            prompt: event.text ?? '',
          });
        }
        if (event.type === 'snapshot') {
          setBuild(null);
          if ((event.version ?? 0) !== htmlVersionRef.current) void pullHtml();
        }
        if (event.type === 'build-failed') setBuild(null);
        if (event.type === 'published' && event.gameId) {
          toast(`@${event.actorName} published the game`);
        }
      },
      onPresence: setMembers,
      onStatus: setStatus,
    });
    return stop;
  }, [roomId, state !== null, me.value?.id, pullHtml]);

  /* Delegated builds run on the server, so someone present has to ask Nanogram
     whether they finished. Only one poller is needed; everyone polls cheaply
     and the first to see the result broadcasts it as a snapshot event. */
  useEffect(() => {
    if (!build || !state?.canBuildOffline) return;
    let alive = true;
    let attempt = 0;
    let timer: number;

    const tick = async () => {
      if (!alive) return;
      try {
        const res = await roomsApi.sync(roomId);
        if (res.synced && !res.running) {
          setBuild(null);
          return;
        }
      } catch {
        /* transient; keep waiting */
      }
      timer = window.setTimeout(() => void tick(), nextDelay(attempt++));
    };
    timer = window.setTimeout(() => void tick(), nextDelay(0));

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [build?.startedAt, state?.canBuildOffline, roomId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events.length, build]);

  /* Stage each build on its own origin, exactly as the single-player flow does. */
  useEffect(() => {
    let alive = true;
    if (!html) {
      setPreviewSrc(null);
      return;
    }
    void ipc
      .stagePreview(html)
      .then((id) => alive && setPreviewSrc(ipc.previewSrc(id)))
      .catch(() => alive && setPreviewSrc(null));
    return () => {
      alive = false;
    };
  }, [html]);

  /* ------------------------------------------------------------ actions --- */

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      if (mode === 'say') {
        // Render the sent message from the response rather than waiting for it
        // to come back round the stream. Otherwise a stalled subscription looks
        // exactly like chat being broken, including to the sender. The seq
        // de-dupe means the echo is harmless when the stream is healthy.
        const { event } = await roomsApi.chat(roomId, text);
        if (event) {
          seqRef.current = Math.max(seqRef.current, event.seq);
          setEvents((prev) =>
            prev.some((e) => e.seq === event.seq)
              ? prev
              : [...prev, event].sort((a, b) => a.seq - b.seq),
          );
        }
      } else {
        const res = await roomsApi.prompt(roomId, text);
        setBuild({
          startedAt: Date.now(),
          by: me.value?.username ?? 'you',
          avatar: me.value?.avatarUrl ?? null,
          prompt: text,
        });
        if (res.mode === 'local') await runLocalBuild(text, res.continueSession ?? null);
      }
    } catch (e) {
      setDraft(text);
      setBuild(null);
      toast(errorMessage(e, "That didn't go through."), 'error');
    } finally {
      setSending(false);
    }
  }

  /**
   * Drive GameGen from this browser, then hand the result back to the room.
   *
   * `continueSession` is set only when this person already owns the session
   * holding the latest build. Otherwise a new session is created seeded with
   * the room's current HTML — GameGen sessions are single-owner, so this is how
   * someone else picks the game up and keeps going without the original builder
   * being present. The room's canonical state is the snapshot, not the session,
   * so the game carries forward and everyone spends their own credits.
   */
  async function runLocalBuild(text: string, continueSession: string | null) {
    if (!state) return;
    try {
      let sessionId = continueSession;
      if (!sessionId) {
        const created = await gamegen.createSession({
          styleId: state.room.styleId ?? '',
          dimension: state.room.dimension ?? undefined,
          description: text,
          remixHtml: html ?? '',
        });
        sessionId = created.id;
        // Persist immediately: a failed build must not orphan a paid-for session.
        await roomsApi.setSession(roomId, sessionId).catch(() => {});
        const owned = sessionId;
        setState((prev) =>
          prev
            ? {
                ...prev,
                room: { ...prev.room, sessionId: owned, sessionOwnerId: me.value?.id ?? null },
              }
            : prev,
        );
      }
      await gamegen.sendMessage(sessionId, text);

      // Adaptive poll: fast enough that short steps feel instant.
      let attempt = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, nextDelay(attempt++)));
        const res = await gamegen.messages(sessionId);
        const last = res.messages?.[res.messages.length - 1];
        const running = last?.status === 'pending' || last?.status === 'running';
        if (!running) {
          const snapshot =
            res.remixHtml ??
            [...(res.messages ?? [])].reverse().find((m) => m.htmlSnapshot)?.htmlSnapshot ??
            null;
          if (snapshot) {
            await roomsApi.snapshot(roomId, {
              html: snapshot,
              sessionId,
              title: res.title ?? undefined,
            });
            setHtml(snapshot);
          }
          break;
        }
        // Give up polling long before the room's own TTL; the result is not lost,
        // it will be picked up next time the room is opened.
        if (attempt > 400) break;
      }
    } catch (e) {
      await roomsApi.buildFailed(roomId, errorMessage(e, 'The build failed.')).catch(() => {});
      toast(errorMessage(e, 'The build failed.'), 'error');
    } finally {
      setBuild(null);
    }
  }

  if (!state) return <FullSpinner />;

  const online = members.filter((m) => m.online);
  const quotaLeft = state.room.creditQuota > 0 ? state.room.creditQuota - state.creditsSpent : null;

  /* Derived from the live member list rather than from `state`, which is the
     snapshot taken when the room was opened and never refetched. */
  const canPublish = Boolean(
    identityKnown && state.room.sessionOwnerId && state.room.sessionOwnerId === me.value?.id,
  );

  return (
    <div class="room">
      <div class="screen-head room-head">
        <button class="icon-btn" onClick={back} aria-label="Back">
          <Icon name="ic_chevron_left" size={20} />
        </button>

        <div class="room-headline">
          <strong class="truncate">{state.room.title}</strong>
          <span class="room-substatus">
            <span class={`room-dot status-${status}`} />
            {status === 'live' ? `${online.length} online` : status === 'reconnecting' ? 'Reconnecting…' : 'Offline'}
          </span>
        </div>

        <span class="spacer" />

        <div class="room-facepile">
          {members.slice(0, 4).map((m) => (
            <span key={m.id} class={`room-av${m.online ? ' is-online' : ''}`} title={`@${m.username}`}>
              <Avatar url={m.avatarUrl} name={m.username} size={26} />
            </span>
          ))}
          {members.length > 4 && <span class="room-av-more">+{members.length - 4}</span>}
        </div>

        {/* In the header rather than over the preview: on a phone only one pane
            renders at a time, so a control living inside the preview is simply
            missing until you happen to switch tabs. Session.tsx does the same. */}
        {/* Publishing runs against the GameGen session, and sessions are
            single-owner — so it is offered to whoever owns the current build,
            which is not necessarily the host. */}
        {canPublish && html && (
          <button
            class="btn btn-primary btn-sm room-publish"
            onClick={() => setPublishOpen(true)}
            disabled={Boolean(build)}
          >
            <Icon name="ic_publish" size={15} />
            <span class="room-publish-label">Publish</span>
          </button>
        )}

        <button class="icon-btn" onClick={() => setShareOpen(true)} aria-label="Invite">
          <Icon name="ic_group_add" size={19} />
        </button>
        {isHost && (
          <button class="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Room settings">
            <Icon name="ic_cog" size={19} />
          </button>
        )}
      </div>

      {/* Phone layout: one pane at a time. */}
      <div class="room-panes" role="tablist">
        <button
          class={`room-pane-tab${pane === 'chat' ? ' is-active' : ''}`}
          onClick={() => setPane('chat')}
          role="tab"
          aria-selected={pane === 'chat'}
        >
          Room
        </button>
        <button
          class={`room-pane-tab${pane === 'game' ? ' is-active' : ''}`}
          onClick={() => setPane('game')}
          role="tab"
          aria-selected={pane === 'game'}
        >
          Game
          {html && <span class="room-pane-dot" />}
        </button>
      </div>

      <div class={`room-body pane-${pane}`}>
        <div class="room-chat">
          <div class="chat-log" ref={logRef}>
            {events.length === 0 && (
              <p class="muted small">
                Say hello, then switch to <strong>Build</strong> to start the game together.
              </p>
            )}

            {events.map((event) => (
              <RoomEventRow key={event.seq} event={event} mine={event.actorId === me.value?.id} />
            ))}

            {build && (
              <BuildStage
                startedAt={build.startedAt}
                requestedBy={build.by}
                requestedByAvatar={build.avatar}
                prompt={build.prompt}
                compact
              />
            )}
          </div>

          <div class="room-composer">
            <div class="room-mode">
              <button
                class={`room-mode-btn${mode === 'say' ? ' is-active' : ''}`}
                onClick={() => setMode('say')}
              >
                Say
              </button>
              <button
                class={`room-mode-btn${mode === 'build' ? ' is-active' : ''}`}
                onClick={() => setMode('build')}
              >
                <Icon name="ic_auto_awesome" size={13} />
                Build
              </button>
              {quotaLeft !== null && (
                <span class={`room-quota${quotaLeft <= 0 ? ' is-out' : ''}`}>
                  {Math.max(0, quotaLeft)} left
                </span>
              )}
            </div>

            <form
              class="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                class="input"
                placeholder={
                  mode === 'say' ? t('chat_composer_placeholder') : 'Describe a change to the game…'
                }
                value={draft}
                maxLength={1000}
                onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              />
              <button
                class="btn btn-primary"
                type="submit"
                disabled={!draft.trim() || sending || (mode === 'build' && Boolean(build))}
              >
                {sending ? <Spinner size={14} /> : <Icon name="ic_streamline_arrow_up_right" size={16} />}
              </button>
            </form>

            {mode === 'build' && identityKnown && !state.canBuildOffline && !canPublish && (
              <p class="room-hint">
                Building picks up from the room's current game and uses your own
                credits.
              </p>
            )}
          </div>
        </div>

        <div class="room-preview">
          {build && !previewSrc ? (
            <BuildStage
              startedAt={build.startedAt}
              requestedBy={build.by}
              requestedByAvatar={build.avatar}
              prompt={build.prompt}
            />
          ) : previewSrc ? (
            <>
              <iframe
                src={previewSrc}
                title="Game preview"
                sandbox={GAME_SANDBOX}
                allow="autoplay; fullscreen; gamepad"
                class="room-frame"
              />

            </>
          ) : (
            <div class="room-empty-game">
              <Icon name="ic_gameboy" size={34} />
              <p class="muted small">
                Nothing built yet. Switch the composer to <strong>Build</strong> and describe the
                game you want.
              </p>
            </div>
          )}
        </div>
      </div>

      {shareOpen && <InviteSheet state={state} onClose={() => setShareOpen(false)} />}
      {settingsOpen && (
        <RoomSettingsSheet
          state={state}
          onClose={() => setSettingsOpen(false)}
          onChanged={(next) => setState(next)}
        />
      )}
      {publishOpen && (
        <PublishSheet
          roomId={roomId}
          sessionId={state.room.sessionId}
          title={state.room.title}
          onClose={() => setPublishOpen(false)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- rows --- */

function RoomEventRow({ event, mine }: { event: RoomEvent; mine: boolean }) {
  if (event.type === 'chat') {
    return (
      <div class={`bubble ${mine ? 'bubble-out' : 'bubble-in'}`}>
        {!mine && <span class="bubble-who">@{event.actorName}</span>}
        {event.text}
      </div>
    );
  }

  if (event.type === 'prompt') {
    return (
      <div class="room-note room-note-prompt">
        <Icon name="ic_auto_awesome" size={13} />
        <span>
          <strong>@{event.actorName}</strong> asked for “{event.text}”
        </span>
      </div>
    );
  }

  const copy: Record<string, string> = {
    join: `@${event.actorName} joined`,
    leave: `@${event.actorName} left`,
    snapshot: `New build from @${event.actorName}`,
    'build-failed': event.text ?? 'A build failed',
    published: `@${event.actorName} published the game`,
    settings: event.text ?? 'Room settings changed',
    'build-start': `@${event.actorName} started a build`,
    'build-done': 'Build finished',
    title: event.text ?? 'Room renamed',
  };

  return (
    <div class="room-note">
      <span>{copy[event.type] ?? event.type}</span>
      <span class="muted"> · {timeAgo(event.at)}</span>
    </div>
  );
}

/* ------------------------------------------------------------- invite --- */

function InviteSheet({ state, onClose }: { state: RoomState; onClose: () => void }) {
  const [friends, setFriends] = useState<FriendUser[] | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  const link = `${location.origin}/?join=${state.room.code}`;

  useEffect(() => {
    void chatApi
      .friends()
      .then((res) => setFriends(res.users ?? []))
      .catch(() => setFriends([]));
  }, []);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`);
    } catch {
      toast("Couldn't copy — select it manually", 'error');
    }
  }

  /* Sending the invite is the one part of a room that Nanogram's own chat API
     can genuinely carry, since it is a normal one-to-one message. */
  async function sendTo(friend: FriendUser) {
    try {
      const chat = await chatApi.create(friend.id);
      await chatApi.send(chat.id, {
        text: `Come build a game with me: ${link}`,
        clientNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setSentTo((prev) => new Set(prev).add(friend.id));
    } catch (e) {
      toast(errorMessage(e, "Couldn't send that."), 'error');
    }
  }

  return (
    <Sheet title="Invite to this room" onClose={onClose}>
      <div class="stack">
        <div class="invite-code" onClick={() => void copy(state.room.code, 'Code')}>
          <span>{state.room.code}</span>
          <Icon name="ic_content_copy" size={16} />
        </div>

        <button class="invite-link" onClick={() => void copy(link, 'Link')}>
          <Icon name="ic_share_link" size={16} />
          <span class="truncate">{link}</span>
        </button>

        <h3 class="section-title">Send to a friend</h3>
        {friends === null && <Spinner size={18} />}
        {friends?.length === 0 && <p class="muted small">No friends to show yet.</p>}
        <div class="list">
          {friends?.map((friend) => (
            <div key={friend.id} class="row">
              <Avatar url={friend.avatarUrl} name={friend.username} size={32} />
              <div class="row-main">
                <div class="row-title">@{friend.username}</div>
              </div>
              <Button
                variant={sentTo.has(friend.id) ? 'ghost' : 'outline'}
                disabled={sentTo.has(friend.id)}
                onClick={() => void sendTo(friend)}
              >
                {sentTo.has(friend.id) ? 'Sent' : 'Send'}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------- settings --- */

function RoomSettingsSheet({
  state,
  onClose,
  onChanged,
}: {
  state: RoomState;
  onClose: () => void;
  onChanged: (next: RoomState) => void;
}) {
  const [title, setTitle] = useState(state.room.title);
  const [quota, setQuota] = useState(state.room.creditQuota ? String(state.room.creditQuota) : '');
  const [hours, setHours] = useState('12');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(state.room.delegated);

  async function saveSettings() {
    setBusy(true);
    try {
      await roomsApi.settings(state.room.id, {
        title: title.trim() || undefined,
        creditQuota: quota.trim() ? Number(quota) : 0,
      });
      onChanged(await roomsApi.get(state.room.id));
      toast('Room updated');
    } catch (e) {
      toast(errorMessage(e, "Couldn't save that."), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function arm() {
    const refreshToken = localRefreshToken();
    if (!refreshToken) {
      toast('Offline building can only be turned on from the web app.', 'error');
      return;
    }
    setBusy(true);
    try {
      await roomsApi.delegate(state.room.id, refreshToken, Number(hours) || 12);
      setArmed(true);
      onChanged(await roomsApi.get(state.room.id));
      toast('The room can now build while you are away');
    } catch (e) {
      toast(errorMessage(e, "Couldn't turn that on."), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await roomsApi.revoke(state.room.id);
      setArmed(false);
      onChanged(await roomsApi.get(state.room.id));
      toast('Offline building turned off');
    } catch (e) {
      toast(errorMessage(e, "Couldn't turn that off."), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Room settings" onClose={onClose}>
      <div class="stack">
        <div>
          <div class="field-label">Room name</div>
          <input
            class="input"
            value={title}
            maxLength={80}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </div>

        <div>
          <div class="field-label">Credit limit</div>
          <input
            class="input"
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="No limit"
            value={quota}
            onInput={(e) => setQuota((e.target as HTMLInputElement).value)}
          />
          <p class="field-hint">
            Used {state.creditsSpent} so far. Builds stop when the limit is reached.
          </p>
        </div>

        <Button full onClick={() => void saveSettings()} loading={busy}>
          Save
        </Button>

        <div class="divider">Put builds on your credits</div>

        <p class="field-hint">
          Everyone in the room can already build — each build continues the
          room's current game in that person's own session, on their own
          credits. This option is separate: it makes builds run on{' '}
          <strong>your</strong> session and your credits instead, so the room
          shares one AI conversation rather than a chain of remixes.
        </p>

        {!state.delegationAvailable ? (
          <p class="field-hint">
            Unavailable: this deployment has no <code>ROOM_DELEGATION_KEY</code> set, so a
            sign-in cannot be stored safely. Building still works for everyone without it.
          </p>
        ) : armed ? (
          <>
            <p class="field-hint">
              The room can build without you. Your sign-in is stored encrypted and is only used for
              this room's builds.
            </p>
            <Button variant="danger" full onClick={() => void revoke()} loading={busy}>
              Turn off and delete it
            </Button>
          </>
        ) : (
          <>
            <p class="field-hint">
              Builds will run on your session and your credits, up to the limit above, even when
              you are not here. Your sign-in is encrypted before it is stored and deleted when you
              turn this off. Only do this in a room you trust.
            </p>
            <div class="hstack">
              <input
                class="input"
                type="number"
                min="1"
                max="48"
                value={hours}
                onInput={(e) => setHours((e.target as HTMLInputElement).value)}
                style={{ width: 90 }}
              />
              <span class="muted small">hours, then it expires on its own</span>
            </div>
            <Button full onClick={() => void arm()} loading={busy}>
              <Icon name="ic_auto_awesome" size={15} />
              Put the room's builds on my credits
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ publish --- */

function PublishSheet({
  roomId,
  sessionId,
  title,
  onClose,
}: {
  roomId: string;
  sessionId: string | null;
  title: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);

  async function publish() {
    if (!sessionId) {
      toast('Nothing to publish yet.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await gamegen.publish(sessionId, name.trim());
      if (res.gameId) {
        await roomsApi.publishedGame(roomId, res.gameId).catch(() => {});
        onClose();
        navigate({ name: 'game', gameId: res.gameId });
      }
    } catch (e) {
      toast(errorMessage(e, "Couldn't publish."), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Publish game" onClose={onClose}>
      <div class="stack">
        <input
          class="input"
          value={name}
          maxLength={80}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <Button full onClick={() => void publish()} loading={busy} disabled={!name.trim()}>
          Publish
        </Button>
      </div>
    </Sheet>
  );
}
