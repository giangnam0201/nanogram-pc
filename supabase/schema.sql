-- Multi-Creator schema.
--
-- Run once against your Supabase project: SQL Editor → paste → Run.
-- Safe to re-run; every statement is idempotent.
--
-- Identity note: users here are Nanogram accounts, not Supabase auth users, so
-- nothing references auth.users. The server verifies a caller's Nanogram token
-- and then mints a short-lived Supabase JWT carrying that verified id in the
-- `ng_user` claim; the policies below authorise against that claim. Clients get
-- read/subscribe access only — every write goes through our API with the
-- service role key, which bypasses RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- rooms ---

create table if not exists public.rooms (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,
  title              text not null default 'Untitled room',
  host_id            text not null,
  host_name          text not null,
  style_id           text,
  dimension          text,
  session_id         text,
  html_version       integer not null default 0,
  published_game_id  text,
  credit_quota       integer not null default 0,
  credits_spent      integer not null default 0,
  delegated          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Rooms are ephemeral by design; a sweep deletes them once this passes.
  expires_at         timestamptz not null default now() + interval '48 hours'
);

create index if not exists rooms_expires_at_idx on public.rooms (expires_at);

-- Added after the first release: GameGen sessions belong to whoever created
-- them, so the room has to remember whose session produced the current build.
-- Only that person's token can drive or publish it.
alter table public.rooms add column if not exists session_owner_id text;

-- -------------------------------------------------------------- members ---

create table if not exists public.room_members (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  user_id     text not null,
  username    text not null,
  avatar_url  text,
  is_host     boolean not null default false,
  joined_at   timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members (user_id);

-- Presence is not stored: it comes from Supabase Realtime Presence, which is
-- ephemeral by nature and costs no database work at all.

-- --------------------------------------------------------------- events ---

-- `id` is the cursor the clients resume from. bigserial is monotonic, which is
-- all the ordering guarantee the stream needs.
create table if not exists public.room_events (
  id            bigserial primary key,
  room_id       uuid not null references public.rooms (id) on delete cascade,
  type          text not null,
  actor_id      text not null,
  actor_name    text not null,
  actor_avatar  text,
  body          text,
  version       integer,
  game_id       text,
  at            timestamptz not null default now()
);

create index if not exists room_events_room_id_idx on public.room_events (room_id, id);

-- ----------------------------------------------------------------- html ---

-- Build snapshots are whole HTML documents, far too large to push through the
-- realtime stream. The event log carries only a version marker; clients fetch
-- the body from the API when that marker changes.
create table if not exists public.room_html (
  room_id     uuid primary key references public.rooms (id) on delete cascade,
  html        text not null,
  version     integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------- delegation ---

-- The host's Nanogram refresh token, AES-256-GCM encrypted by the API before
-- it ever arrives here. No RLS policy is defined for this table, so with RLS
-- enabled it is unreachable by any client key — only the service role can
-- touch it.
create table if not exists public.room_delegation (
  room_id            uuid primary key references public.rooms (id) on delete cascade,
  host_id            text not null,
  refresh_token_enc  text not null,
  armed_at           timestamptz not null default now(),
  expires_at         timestamptz not null
);

-- ------------------------------------------------------------------ rls ---

alter table public.rooms           enable row level security;
alter table public.room_members    enable row level security;
alter table public.room_events     enable row level security;
alter table public.room_html       enable row level security;
alter table public.room_delegation enable row level security;

-- The verified Nanogram user id, as carried in our minted JWT.
create or replace function public.ng_user() returns text
language sql stable
as $$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'ng_user', '') $$;

create or replace function public.is_room_member(target uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = target and m.user_id = public.ng_user()
  )
$$;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms
  for select using (public.is_room_member(id));

drop policy if exists room_members_read on public.room_members;
create policy room_members_read on public.room_members
  for select using (public.is_room_member(room_id));

drop policy if exists room_events_read on public.room_events;
create policy room_events_read on public.room_events
  for select using (public.is_room_member(room_id));

drop policy if exists room_html_read on public.room_html;
create policy room_html_read on public.room_html
  for select using (public.is_room_member(room_id));

-- room_delegation intentionally has no policy: service role only.

-- ------------------------------------------------------------- realtime ---

-- Publish event inserts so clients can subscribe. Only room_events is
-- published; everything else is fetched through the API on demand.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'room_events'
  ) then
    alter publication supabase_realtime add table public.room_events;
  end if;
end $$;

-- ------------------------------------------------------------ counters ---

-- Atomic, because two people can start a build in the same instant and a
-- read-modify-write from the API would let one of them slip past the quota.
create or replace function public.spend_room_credit(room uuid) returns integer
language sql security definer set search_path = public
as $$
  update public.rooms
     set credits_spent = credits_spent + 1, updated_at = now()
   where id = room
  returning credits_spent
$$;

-- ---------------------------------------------------------------- sweep ---

-- Expired rooms cascade to their members, events, html and delegation.
create or replace function public.sweep_expired_rooms() returns integer
language sql security definer set search_path = public
as $$
  with gone as (delete from public.rooms where expires_at < now() returning 1)
  select count(*)::integer from gone
$$;

-- Optional, needs pg_cron enabled under Database → Extensions:
--   select cron.schedule('sweep-rooms', '17 * * * *', $$select public.sweep_expired_rooms()$$);
-- Without it the API sweeps opportunistically instead.
