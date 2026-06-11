-- Warroom Chat Schema
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
