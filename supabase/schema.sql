-- Warroom SQL Schema
-- Run this in your Supabase project's SQL editor (https://app.supabase.com → SQL Editor)

-- ─── Teams ───────────────────────────────────────────────────────────────────

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 12 hex chars (~48 bits). The invite code is both the join secret and the
  -- chat-encryption KDF input, so it must resist guessing; 8 chars (32 bits) was
  -- brute-forceable. Existing rows keep their old code (see migration below).
  invite_code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  owner_id uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Migration: widen the default for databases created before the 12-char change.
alter table teams alter column invite_code
  set default substr(md5(random()::text || clock_timestamp()::text), 1, 12);

-- ─── Team members ─────────────────────────────────────────────────────────────

create table if not exists team_members (
  team_id uuid references teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null,
  role text check (role in ('debater', 'coach')) default 'debater',
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- ─── Messages ─────────────────────────────────────────────────────────────────

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  sender_id uuid references auth.users(id),
  sender_name text not null,
  content text not null,
  round_ref_id text,
  round_ref_label text,
  created_at timestamptz default now()
);

-- ─── Attachments (@ mentioned cases / blocks / flows) ────────────────────────

create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  type text check (type in ('case', 'block', 'flow', 'opponent', 'member')) not null,
  name text not null,
  data jsonb not null  -- serialized case, block, or flow records
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists messages_team_created_idx on messages(team_id, created_at desc);
create index if not exists message_attachments_message_idx on message_attachments(message_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────

alter table teams enable row level security;
alter table team_members enable row level security;
alter table messages enable row level security;
alter table message_attachments enable row level security;

-- Helper: look up a team by invite code without being a member.
-- joinTeam queries teams before the user is a member, so the normal SELECT
-- policy (is_team_member) would deny it. security definer bypasses that.
create or replace function get_team_by_invite(invite text)
returns table(id uuid, name text, invite_code text, owner_id uuid)
language sql security definer
set search_path = ''
as $$
  select id, name, invite_code, owner_id from public.teams
  where invite_code = lower(trim(invite))
  limit 1;
$$;

-- Helper: look up any registered user by email (bypasses auth.users RLS)
-- Returns user_id + display_name so callers can DM someone not on their team.
create or replace function lookup_user_by_email(lookup_email text)
returns table(user_id uuid, display_name text)
language sql security definer
set search_path = ''
as $$
  select
    u.id as user_id,
    coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)) as display_name
  from auth.users u
  where lower(u.email) = lower(lookup_email)
  limit 1;
$$;

-- Tighten execute grants: revoke PUBLIC (which anon inherits) so these
-- SECURITY DEFINER helpers aren't callable unauthenticated via REST RPC.
-- is_team_member / is_dm_member are RLS-policy-only; no role needs direct
-- RPC access. get_team_by_invite / lookup_user_by_email are called by the
-- app but only by signed-in users.
revoke execute on function public.get_team_by_invite(text) from public;
grant execute on function public.get_team_by_invite(text) to authenticated;

revoke execute on function public.lookup_user_by_email(text) from public;
grant execute on function public.lookup_user_by_email(text) to authenticated;

-- Join a team by invite code. SECURITY DEFINER so it can verify the code and insert
-- the membership row in one trusted step — this is the ONLY way to gain membership,
-- which keeps the invite-code check on the server (it used to live only in app code,
-- with RLS allowing any self-insert). Always inserts the *calling* user (auth.uid()),
-- so it can't be used to add anyone else.
create or replace function join_team_by_code(p_invite text, p_display_name text, p_role text)
returns table(id uuid, name text, invite_code text, owner_id uuid)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into v_team from public.teams
    where public.teams.invite_code = lower(trim(p_invite))
    limit 1;
  if v_team.id is null then
    return; -- no matching team → caller surfaces "Invalid invite code"
  end if;
  insert into public.team_members (team_id, user_id, display_name, role)
  values (
    v_team.id,
    auth.uid(),
    coalesce(nullif(trim(p_display_name), ''), 'Member'),
    case when p_role = 'coach' then 'coach' else 'debater' end
  )
  on conflict (team_id, user_id)
  do update set display_name = excluded.display_name, role = excluded.role;

  return query select v_team.id, v_team.name, v_team.invite_code, v_team.owner_id;
end;
$$;

revoke execute on function public.join_team_by_code(text, text, text) from public;
grant execute on function public.join_team_by_code(text, text, text) to authenticated;

-- Helper: is the current user a member of the given team?
create or replace function is_team_member(tid uuid)
returns boolean
language sql security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members
    where team_id = tid and user_id = auth.uid()
  );
$$;

-- Teams: members can read; anyone authenticated can create
drop policy if exists "team_members_can_read" on teams;
create policy "team_members_can_read" on teams
  for select using (is_team_member(id));

-- Team creator (owner) can read their own team.
-- Needed because createTeam reads back the row immediately after insert,
-- before the creator has been added to team_members.
drop policy if exists "team_creator_can_read" on teams;
create policy "team_creator_can_read" on teams
  for select using (owner_id = auth.uid());

drop policy if exists "authenticated_can_create_team" on teams;
create policy "authenticated_can_create_team" on teams
  for insert with check (auth.uid() is not null);

-- Team members: members can read own team roster; insert only for self
-- "read_own" allows reading your own row without depending on is_team_member,
-- which fixes a race where auth.uid() is null during async storage init.
drop policy if exists "team_members_can_read_own" on team_members;
create policy "team_members_can_read_own" on team_members
  for select using (user_id = auth.uid());

drop policy if exists "team_members_can_read_roster" on team_members;
create policy "team_members_can_read_roster" on team_members
  for select using (is_team_member(team_id));

-- NOTE: there is deliberately NO open INSERT policy on team_members. Membership is
-- granted only through join_team_by_code() (defined below), a SECURITY DEFINER
-- function that re-checks the invite code server-side. A prior policy allowed any
-- authenticated user to insert themselves into ANY team (it only checked
-- user_id = auth.uid()), so knowing a team's UUID was enough to join and a kicked
-- member could simply re-insert. Drop it if it exists from an older deploy.
drop policy if exists "team_members_can_join" on team_members;

-- Messages: team members can read + insert
drop policy if exists "team_members_can_read_messages" on messages;
create policy "team_members_can_read_messages" on messages
  for select using (is_team_member(team_id));

drop policy if exists "team_members_can_send_messages" on messages;
create policy "team_members_can_send_messages" on messages
  for insert with check (
    sender_id = auth.uid() and is_team_member(team_id)
  );

-- Attachments: readable/insertable if user is in the message's team
drop policy if exists "team_members_can_read_attachments" on message_attachments;
create policy "team_members_can_read_attachments" on message_attachments
  for select using (
    exists (
      select 1 from messages m
      where m.id = message_id and is_team_member(m.team_id)
    )
  );

drop policy if exists "team_members_can_insert_attachments" on message_attachments;
create policy "team_members_can_insert_attachments" on message_attachments
  for insert with check (
    exists (
      select 1 from messages m
      where m.id = message_id and is_team_member(m.team_id)
    )
  );

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Enable realtime for the messages table in your Supabase dashboard:
-- Database → Replication → Tables → check "messages" and "dm_messages"

-- ─── Migration: room management ───────────────────────────────────────────────
-- Run these in Supabase SQL Editor to enable room management features.

alter table teams add column if not exists owner_id uuid references auth.users(id);

drop policy if exists "team_owner_can_update" on teams;
create policy "team_owner_can_update" on teams
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "team_owner_can_kick" on team_members;
create policy "team_owner_can_kick" on team_members
  for delete using (
    user_id != auth.uid() and
    exists (select 1 from teams where id = team_id and owner_id = auth.uid())
  );

-- Allow a team member to claim ownership when the team has no owner yet.
-- The existing team_owner_can_update policy requires owner_id = auth.uid(),
-- which never matches a NULL owner_id.
drop policy if exists "team_members_can_claim_ownership" on teams;
create policy "team_members_can_claim_ownership" on teams
  for update using (owner_id is null and is_team_member(id))
  with check (owner_id = auth.uid());

drop policy if exists "members_can_leave" on team_members;
create policy "members_can_leave" on team_members
  for delete using (user_id = auth.uid());

-- ─── DM channels ──────────────────────────────────────────────────────────────

create table if not exists dm_channels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade not null,
  name text,  -- null = 1:1 DM, set = named group
  created_at timestamptz default now()
);

create table if not exists dm_channel_members (
  dm_channel_id uuid references dm_channels(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  primary key (dm_channel_id, user_id)
);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  dm_channel_id uuid references dm_channels(id) on delete cascade not null,
  sender_id uuid references auth.users(id),
  sender_name text not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists dm_message_attachments (
  id uuid primary key default gen_random_uuid(),
  dm_message_id uuid references dm_messages(id) on delete cascade not null,
  type text check (type in ('case', 'block', 'flow', 'opponent', 'member')) not null,
  name text not null,
  data jsonb not null,
  permission text check (permission in ('edit', 'view')) default 'edit'
);

alter table dm_channels enable row level security;
alter table dm_channel_members enable row level security;
alter table dm_messages enable row level security;
alter table dm_message_attachments enable row level security;

create or replace function is_dm_member(cid uuid)
returns boolean language sql security definer
set search_path = ''
as $$
  select exists (select 1 from public.dm_channel_members where dm_channel_id = cid and user_id = auth.uid());
$$;

-- RLS-policy helpers. Revoke PUBLIC so the anon role can't call them via REST RPC,
-- but they MUST be executable by `authenticated`: a function referenced in an RLS
-- policy is invoked by the *calling* role, and Postgres checks EXECUTE on that role
-- even for SECURITY DEFINER functions. Without the grant, every policy that calls
-- is_team_member / is_dm_member fails with "permission denied for function ..."
-- (e.g. creating a team, reading the roster, sending a message).
revoke execute on function public.is_team_member(uuid) from public;
revoke execute on function public.is_dm_member(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_dm_member(uuid) to authenticated;

drop policy if exists "dm_read_channels" on dm_channels;
create policy "dm_read_channels" on dm_channels for select using (is_dm_member(id));
drop policy if exists "dm_create_channels" on dm_channels;
create policy "dm_create_channels" on dm_channels for insert with check (is_team_member(team_id));
drop policy if exists "dm_read_members" on dm_channel_members;
create policy "dm_read_members" on dm_channel_members for select using (is_dm_member(dm_channel_id));
drop policy if exists "dm_add_members" on dm_channel_members;
create policy "dm_add_members" on dm_channel_members for insert with check (
  exists (select 1 from dm_channels where id = dm_channel_id and is_team_member(team_id))
);
drop policy if exists "dm_read_messages" on dm_messages;
create policy "dm_read_messages" on dm_messages for select using (is_dm_member(dm_channel_id));
drop policy if exists "dm_send_messages" on dm_messages;
create policy "dm_send_messages" on dm_messages for insert with check (
  sender_id = auth.uid() and is_dm_member(dm_channel_id)
);
drop policy if exists "dm_att_read" on dm_message_attachments;
create policy "dm_att_read" on dm_message_attachments for select using (
  exists (
    select 1 from dm_messages dm
    join dm_channel_members dcm on dcm.dm_channel_id = dm.dm_channel_id
    where dm.id = dm_message_id and dcm.user_id = auth.uid()
  )
);
drop policy if exists "dm_att_insert" on dm_message_attachments;
create policy "dm_att_insert" on dm_message_attachments for insert with check (
  exists (select 1 from dm_messages where id = dm_message_id and sender_id = auth.uid())
);

-- ─── Shared notes ─────────────────────────────────────────────────────────────
-- Scouting notes on opponents and judges, scoped to a team.
-- entity_id is a stable cross-user identifier:
--   opponent → teamId from OpenCaselist (or "school/teamName" slug)
--   judge    → Tabroom person_id

create table if not exists shared_notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade not null,
  entity_type text check (entity_type in ('opponent', 'judge')) not null,
  entity_id text not null,
  entity_name text not null,
  user_id uuid references auth.users(id) not null,
  user_name text not null,
  content text not null default '',
  updated_at timestamptz default now(),
  unique (team_id, entity_type, entity_id, user_id)
);

alter table shared_notes enable row level security;

drop policy if exists "team_members_can_read_shared_notes" on shared_notes;
create policy "team_members_can_read_shared_notes" on shared_notes
  for select using (is_team_member(team_id));

drop policy if exists "users_can_insert_own_notes" on shared_notes;
create policy "users_can_insert_own_notes" on shared_notes
  for insert with check (user_id = auth.uid() and is_team_member(team_id));

drop policy if exists "users_can_update_own_notes" on shared_notes;
create policy "users_can_update_own_notes" on shared_notes
  for update using (user_id = auth.uid() and is_team_member(team_id))
  with check (user_id = auth.uid() and is_team_member(team_id));

create index if not exists shared_notes_entity_idx on shared_notes(team_id, entity_type, entity_id);

-- ─── Migration: image attachments ─────────────────────────────────────────────
-- Expand the type check constraint to allow 'image' attachments.

alter table message_attachments drop constraint if exists message_attachments_type_check;
alter table message_attachments add constraint message_attachments_type_check
  check (type in ('case', 'block', 'flow', 'opponent', 'member', 'image'));

alter table dm_message_attachments drop constraint if exists dm_message_attachments_type_check;
alter table dm_message_attachments add constraint dm_message_attachments_type_check
  check (type in ('case', 'block', 'flow', 'opponent', 'member', 'image'));

-- ─── Migration: message edit / delete ─────────────────────────────────────────
-- editMessage/deleteMessage update or delete by message id with no policy and no
-- ownership filter. Without these policies the operations are denied under RLS;
-- a naive policy would let anyone edit/delete anyone's messages. Scope to sender.

alter table messages add column if not exists edited boolean default false;
alter table dm_messages add column if not exists edited boolean default false;

-- Messages: only the original sender may edit or delete their own message
drop policy if exists "sender_can_update_message" on messages;
create policy "sender_can_update_message" on messages
  for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists "sender_can_delete_message" on messages;
create policy "sender_can_delete_message" on messages
  for delete using (sender_id = auth.uid());

-- Attachments deletable only when you can delete the parent message
-- (deleteMessage removes attachments first, while the message still exists)
drop policy if exists "sender_can_delete_attachments" on message_attachments;
create policy "sender_can_delete_attachments" on message_attachments
  for delete using (
    exists (select 1 from messages m where m.id = message_id and m.sender_id = auth.uid())
  );

-- DM messages: same, scoped to sender
drop policy if exists "sender_can_update_dm_message" on dm_messages;
create policy "sender_can_update_dm_message" on dm_messages
  for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists "sender_can_delete_dm_message" on dm_messages;
create policy "sender_can_delete_dm_message" on dm_messages
  for delete using (sender_id = auth.uid());

drop policy if exists "sender_can_delete_dm_attachments" on dm_message_attachments;
create policy "sender_can_delete_dm_attachments" on dm_message_attachments
  for delete using (
    exists (select 1 from dm_messages dm where dm.id = dm_message_id and dm.sender_id = auth.uid())
  );

-- ─── Collaborative flows (live realtime flowing) ──────────────────────────────
-- A flow promoted to "live" gets a row here so teammates can edit it together in
-- realtime. The live transport is Supabase Realtime *broadcast* on an unguessable
-- channel (`flow-<id>`); this table only holds the durable Yjs snapshot so a
-- teammate who opens the flow later (or reconnects) loads the current state.
-- `content` is base64 of the encoded Yjs document state (Y.encodeStateAsUpdate).
create table if not exists flows (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  owner_id uuid references auth.users(id),
  name text not null default 'Flow',
  content text,                       -- base64( Y.encodeStateAsUpdate(doc) )
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists flows_team_updated_idx on flows(team_id, updated_at desc);

alter table flows enable row level security;

-- Any team member can read a flow shared into their team.
drop policy if exists "team_members_can_read_flows" on flows;
create policy "team_members_can_read_flows" on flows
  for select using (is_team_member(team_id));

-- A team member can promote one of their flows to live (owner = themselves).
drop policy if exists "team_members_can_insert_flows" on flows;
create policy "team_members_can_insert_flows" on flows
  for insert with check (owner_id = auth.uid() and is_team_member(team_id));

-- Any team member can update the shared snapshot — that's the whole point of
-- collaborative editing. (Live edits go over broadcast; this only persists the
-- merged Yjs state on a debounce.)
drop policy if exists "team_members_can_update_flows" on flows;
create policy "team_members_can_update_flows" on flows
  for update using (is_team_member(team_id)) with check (is_team_member(team_id));

-- Only the owner can delete the live flow.
drop policy if exists "flow_owner_can_delete" on flows;
create policy "flow_owner_can_delete" on flows
  for delete using (owner_id = auth.uid());

-- ─── Realtime Authorization for live-flow broadcast ───────────────────────────
-- Live flowing uses a PRIVATE Supabase Realtime broadcast channel named
-- `flow-<flow id>`. Private channels enforce RLS on `realtime.messages`, so these
-- policies are what actually restrict who can read/inject live edits: only a
-- member of the flow's team. Previously the channel was public, so the flow UUID
-- was the only secret — anyone with the (public) anon key and a flow id, including
-- a removed teammate, could join, read every keystroke, and broadcast malicious
-- Yjs updates. `realtime.topic()` returns the channel name for the current message;
-- we parse the flow id out of it and check team membership.
--
-- Helper: is the current user allowed on this flow's realtime channel?
create or replace function can_access_flow_channel(topic text)
returns boolean
language sql security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.flows f
    where topic = 'flow-' || f.id::text
      and public.is_team_member(f.team_id)
  );
$$;

revoke execute on function public.can_access_flow_channel(text) from public;
grant execute on function public.can_access_flow_channel(text) to authenticated;

-- Receiving broadcasts + presence sync on a flow channel (SELECT on realtime.messages).
drop policy if exists "flow_members_can_read_broadcast" on realtime.messages;
create policy "flow_members_can_read_broadcast" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_flow_channel(realtime.topic())
  );

-- Sending broadcasts + presence tracking on a flow channel (INSERT on realtime.messages).
drop policy if exists "flow_members_can_send_broadcast" on realtime.messages;
create policy "flow_members_can_send_broadcast" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_flow_channel(realtime.topic())
  );

-- ─── Impact Library (global shared library) ───────────────────────────────────
-- A cross-user, app-wide library of debate impacts. Unlike everything above this
-- is NOT team-scoped — every signed-in user reads the same pool and can contribute
-- to it. Each entry is an AI-structured impact (magnitude/probability/timeframe/
-- reversibility broken out separately, plus generated answers and tags). Authors
-- are anonymous by default and may opt into showing their chat display name.

create table if not exists impact_library (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Anonymous', -- chat display name captured at submit
  anonymous boolean not null default true,        -- when true, hide author_name in the UI
  event text check (event in ('policy', 'pf', 'ld', 'general')) not null default 'general',
  title text not null,
  claim text not null default '',
  magnitude text not null default '',
  magnitude_note text not null default '',
  probability text not null default '',
  probability_note text not null default '',
  timeframe text not null default '',
  timeframe_note text not null default '',
  reversibility text not null default '',
  reversibility_note text not null default '',
  answers text[] not null default '{}',           -- standard ways to beat this impact
  tags text[] not null default '{}',              -- topic / position tags for search
  like_count integer not null default 0,          -- denormalized, maintained by trigger
  dislike_count integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists impact_library_created_idx on impact_library(created_at desc);
create index if not exists impact_library_score_idx on impact_library(like_count desc);
create index if not exists impact_library_event_idx on impact_library(event);
create index if not exists impact_library_tags_idx on impact_library using gin(tags);

-- One like/dislike per user per entry. vote = 1 (like) or -1 (dislike).
create table if not exists impact_library_votes (
  entry_id uuid references impact_library(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (1, -1)),
  reason text,                                    -- optional quick reason tag
  created_at timestamptz default now(),
  primary key (entry_id, user_id)
);

-- Personal saves (a user's own bookmark list, separate from the shared library).
create table if not exists impact_library_saves (
  entry_id uuid references impact_library(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (entry_id, user_id)
);

-- Keep like_count / dislike_count on impact_library in sync with the votes table.
create or replace function refresh_impact_vote_counts(p_entry uuid)
returns void language sql security definer set search_path = '' as $$
  update public.impact_library il set
    like_count    = (select count(*) from public.impact_library_votes v where v.entry_id = p_entry and v.vote = 1),
    dislike_count = (select count(*) from public.impact_library_votes v where v.entry_id = p_entry and v.vote = -1)
  where il.id = p_entry;
$$;

create or replace function impact_vote_counts_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE') then
    perform public.refresh_impact_vote_counts(old.entry_id);
    return old;
  else
    perform public.refresh_impact_vote_counts(new.entry_id);
    return new;
  end if;
end;
$$;

drop trigger if exists impact_votes_count_trigger on impact_library_votes;
create trigger impact_votes_count_trigger
  after insert or update or delete on impact_library_votes
  for each row execute function impact_vote_counts_trigger();

alter table impact_library enable row level security;
alter table impact_library_votes enable row level security;
alter table impact_library_saves enable row level security;

-- Any authenticated user may read the whole library and everyone's vote tallies.
drop policy if exists "impact_library_read" on impact_library;
create policy "impact_library_read" on impact_library
  for select using (auth.uid() is not null);

-- Contribute: insert only as yourself.
drop policy if exists "impact_library_insert" on impact_library;
create policy "impact_library_insert" on impact_library
  for insert with check (author_id = auth.uid());

-- Edit / delete only your own entries.
drop policy if exists "impact_library_update_own" on impact_library;
create policy "impact_library_update_own" on impact_library
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "impact_library_delete_own" on impact_library;
create policy "impact_library_delete_own" on impact_library
  for delete using (author_id = auth.uid());

-- Votes: everyone authenticated can read (for counts/aggregation); write only your own.
drop policy if exists "impact_votes_read" on impact_library_votes;
create policy "impact_votes_read" on impact_library_votes
  for select using (auth.uid() is not null);

drop policy if exists "impact_votes_upsert" on impact_library_votes;
create policy "impact_votes_upsert" on impact_library_votes
  for insert with check (user_id = auth.uid());

drop policy if exists "impact_votes_update_own" on impact_library_votes;
create policy "impact_votes_update_own" on impact_library_votes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "impact_votes_delete_own" on impact_library_votes;
create policy "impact_votes_delete_own" on impact_library_votes
  for delete using (user_id = auth.uid());

-- Saves are private: you only ever see and manage your own.
drop policy if exists "impact_saves_read_own" on impact_library_saves;
create policy "impact_saves_read_own" on impact_library_saves
  for select using (user_id = auth.uid());

drop policy if exists "impact_saves_insert_own" on impact_library_saves;
create policy "impact_saves_insert_own" on impact_library_saves
  for insert with check (user_id = auth.uid());

drop policy if exists "impact_saves_delete_own" on impact_library_saves;
create policy "impact_saves_delete_own" on impact_library_saves
  for delete using (user_id = auth.uid());

-- ─── Migration: reply-to (quote a specific message) ───────────────────────────
-- reply_to_id is a soft link (on delete set null) so a reply survives the
-- original message being deleted — the quoted snapshot (sender name + content,
-- captured client-side at send time and encrypted like `content`) keeps
-- displaying even after the original is gone or edited.
alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;
alter table messages add column if not exists reply_to_sender_name text;
alter table messages add column if not exists reply_to_content text;

alter table dm_messages add column if not exists reply_to_id uuid references dm_messages(id) on delete set null;
alter table dm_messages add column if not exists reply_to_sender_name text;
alter table dm_messages add column if not exists reply_to_content text;

-- ─── Migration: server-side rate limiting ──────────────────────────────────────
-- The Supabase anon key ships inside every Warroom installer, so any app-level
-- (Electron main process) rate limit can be bypassed by extracting the key and
-- hitting these tables directly via the REST API. These limits live in Postgres
-- itself — enforced by BEFORE INSERT/UPDATE triggers, which fire regardless of
-- how the write arrives (supabase-js, raw REST, or anything else authenticated
-- as that user). This is the bypass-proof layer for team/DM messages and the
-- shared Impact Library. (Auth endpoints — sign in/up, password reset — are
-- throttled app-side in electron/main.ts AND should have Supabase's own
-- Authentication → Rate Limits enabled in the dashboard for the same reason.)

create table if not exists rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_lookup_idx on rate_limit_events(user_id, action, created_at desc);

-- Records this attempt and raises if the caller has exceeded `p_max_count`
-- actions of type `p_action` within the trailing `p_window`. Self-cleans old
-- events for this (user, action) pair on every call, so the table stays small
-- for active users without needing a separate cron job.
create or replace function enforce_rate_limit(p_action text, p_max_count int, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.rate_limit_events
    where user_id = v_uid and action = p_action and created_at < now() - p_window;

  select count(*) into v_count
    from public.rate_limit_events
    where user_id = v_uid and action = p_action and created_at >= now() - p_window;

  if v_count >= p_max_count then
    raise exception 'You''re doing that too fast — try again in a bit.';
  end if;

  insert into public.rate_limit_events (user_id, action) values (v_uid, p_action);
end;
$$;

-- Team messages: generous burst limit, only stops flood scripts.
create or replace function rl_check_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.enforce_rate_limit('team_message', 20, interval '30 seconds');
  return new;
end;
$$;
drop trigger if exists rl_messages_trigger on messages;
create trigger rl_messages_trigger before insert on messages
  for each row execute function rl_check_message();

-- DM messages: same burst limit as team messages.
create or replace function rl_check_dm_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.enforce_rate_limit('dm_message', 20, interval '30 seconds');
  return new;
end;
$$;
drop trigger if exists rl_dm_messages_trigger on dm_messages;
create trigger rl_dm_messages_trigger before insert on dm_messages
  for each row execute function rl_check_dm_message();

-- Impact Library submissions: this is curated shared content visible to every
-- user of the app, not a private chat — much stricter than messages.
create or replace function rl_check_impact_submit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.enforce_rate_limit('impact_submit', 5, interval '1 hour');
  return new;
end;
$$;
drop trigger if exists rl_impact_library_insert_trigger on impact_library;
create trigger rl_impact_library_insert_trigger before insert on impact_library
  for each row execute function rl_check_impact_submit();

-- Impact Library edits: only rate-limit genuine top-level edits from
-- impactlib:update — NOT the like_count/dislike_count side-effect update that
-- refresh_impact_vote_counts() runs from inside the vote-count trigger below.
-- pg_trigger_depth() > 1 means we're nested inside another trigger's own write
-- (the vote trigger, depth 1) rather than a direct client UPDATE (depth 1 itself).
create or replace function rl_check_impact_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  perform public.enforce_rate_limit('impact_update', 15, interval '1 hour');
  return new;
end;
$$;
drop trigger if exists rl_impact_library_update_trigger on impact_library;
create trigger rl_impact_library_update_trigger before update on impact_library
  for each row execute function rl_check_impact_update();

-- Impact Library votes: generous limit. Uses BEFORE INSERT OR UPDATE since the
-- client upserts (a changed vote hits the ON CONFLICT DO UPDATE path) — the
-- limit is generous enough that a possible double-count on a single upsert
-- doesn't meaningfully affect real usage.
create or replace function rl_check_impact_vote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.enforce_rate_limit('impact_vote', 60, interval '1 hour');
  return new;
end;
$$;
drop trigger if exists rl_impact_votes_trigger on impact_library_votes;
create trigger rl_impact_votes_trigger before insert or update on impact_library_votes
  for each row execute function rl_check_impact_vote();

alter table rate_limit_events enable row level security;
-- No client-facing policies on purpose: rate_limit_events is only ever touched
-- by the security-definer functions above, never directly by client queries.

-- ─── Migration: note tag attachments (tag docs/flows/opponents/judges in notes) ─
-- Generalizes message_attachments so a row can be tied to a shared_notes
-- entity (team_id + entity_type + entity_id + owning user) instead of only
-- a chat message. Lets users tag docs/flows/opponents/judges in opponent
-- and judge notes, visible to teammates the next time they open that entity.

alter table message_attachments add column if not exists team_id uuid references teams(id) on delete cascade;
alter table message_attachments add column if not exists note_entity_type text check (note_entity_type in ('opponent','judge'));
alter table message_attachments add column if not exists note_entity_id text;
alter table message_attachments add column if not exists note_user_id uuid references auth.users(id);
alter table message_attachments add column if not exists note_user_name text;
alter table message_attachments add column if not exists created_at timestamptz default now();

alter table message_attachments drop constraint if exists message_attachments_parent_check;
alter table message_attachments add constraint message_attachments_parent_check
  check (
    message_id is not null
    or (note_entity_type is not null and note_entity_id is not null and note_user_id is not null and team_id is not null)
  );

alter table message_attachments drop constraint if exists message_attachments_type_check;
alter table message_attachments add constraint message_attachments_type_check
  check (type in ('case', 'block', 'flow', 'opponent', 'member', 'image', 'speechdoc', 'judge'));

create index if not exists message_attachments_note_idx
  on message_attachments(team_id, note_entity_type, note_entity_id);

drop policy if exists "team_members_can_read_attachments" on message_attachments;
create policy "team_members_can_read_attachments" on message_attachments
  for select using (
    (message_id is not null and exists (
      select 1 from messages m where m.id = message_id and is_team_member(m.team_id)
    ))
    or (note_entity_type is not null and is_team_member(team_id))
  );

drop policy if exists "team_members_can_insert_attachments" on message_attachments;
create policy "team_members_can_insert_attachments" on message_attachments
  for insert with check (
    (message_id is not null and exists (
      select 1 from messages m where m.id = message_id and is_team_member(m.team_id)
    ))
    or (note_entity_type is not null and note_user_id = auth.uid() and is_team_member(team_id))
  );

drop policy if exists "note_owner_can_delete_attachments" on message_attachments;
create policy "note_owner_can_delete_attachments" on message_attachments
  for delete using (note_entity_type is not null and note_user_id = auth.uid());

-- ─── Team Files ────────────────────────────────────────────────────────────────
-- A per-team file library, separate from the chat message stream. Each row is one
-- uploaded document. `name` and `data_b64` (the raw file bytes, base64-encoded)
-- are encrypted client-side with the team key exactly like message content — see
-- src/lib/chatCrypto.ts. `uploader_name` stays plaintext (same tier as sender_name
-- on messages) purely for display.
--
-- "Auto-update": the uploader's own client watches the local file on disk (see
-- team_file_watches.json + fs.watch in electron/main.ts) and pushes a re-encrypted
-- data_b64 + bumped updated_at whenever that file changes on disk — but only while
-- that uploader's Warroom app is running. Other members just see updated_at move
-- and can re-open the file to get the latest version; nothing polls on their end.
create table if not exists team_files (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade not null,
  uploader_id uuid references auth.users(id),
  uploader_name text not null,
  name text not null,        -- encrypted
  data_b64 text not null,    -- encrypted (base64 of raw file bytes)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists team_files_team_idx on team_files(team_id, updated_at desc);

alter table team_files enable row level security;

drop policy if exists "team_files_select" on team_files;
create policy "team_files_select" on team_files
  for select using (is_team_member(team_id));

drop policy if exists "team_files_insert" on team_files;
create policy "team_files_insert" on team_files
  for insert with check (is_team_member(team_id) and uploader_id = auth.uid());

-- Only the uploader can push new content (auto-update) or rename their own file.
drop policy if exists "team_files_update_own" on team_files;
create policy "team_files_update_own" on team_files
  for update using (uploader_id = auth.uid()) with check (uploader_id = auth.uid());

drop policy if exists "team_files_delete_own" on team_files;
create policy "team_files_delete_own" on team_files
  for delete using (uploader_id = auth.uid());
