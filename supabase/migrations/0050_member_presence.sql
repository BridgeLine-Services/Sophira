-- =====================================================================
-- 0050: MEMBER PRESENCE AND ACCOUNT CONDITION (2026-11-12)
--
-- The owner had one signal of life: profiles.last_active_at, which only moves
-- when a write happens. A member reading for an hour looked offline; a member
-- who closed their laptop looked active for days. Presence and account standing
-- are now separate models, because they answer different questions:
--
--   member_presence.version rows   -> "is someone at their screen right now?"
--   profiles.status                -> "is this account allowed to be used?"
--
-- A member can be Active with a Suspended account (never Online), or Active with
-- an Offline session. Nothing here merges the two into one column.
--
-- PRIVACY: a session row holds a random per-tab identifier, a heartbeat, an
-- optional interaction timestamp and an expiry. No IP address, no user agent, no
-- device fingerprint, no page path, no conversation content, ever.
--
-- ADDITIVE ONLY. New tables, new functions, one new nullable-time column set. No
-- existing table, policy or row is altered or removed.
-- =====================================================================

-- ---- 1. Sessions -----------------------------------------------------
create table if not exists public.member_presence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- An opaque value the tab generates for itself. Deliberately NOT a device
  -- fingerprint: it identifies a tab, not a person's hardware.
  session_id text not null,
  connection_state text not null default 'connected'
    check (connection_state in ('connected', 'unreachable')),
  manual_availability text
    check (manual_availability is null or manual_availability in ('available', 'away', 'busy', 'dnd')),
  last_heartbeat timestamptz not null default now(),
  last_interaction timestamptz,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_presence_session_unique unique (user_id, session_id)
);

create index if not exists member_presence_user_idx on public.member_presence (user_id);
create index if not exists member_presence_heartbeat_idx on public.member_presence (last_heartbeat desc);

alter table public.member_presence enable row level security;

-- A member sees and maintains only their own sessions. Staff may read all of
-- them for the directory; staff never need to write someone else's session, so
-- there is no such policy.
drop policy if exists member_presence_own_read on public.member_presence;
create policy member_presence_own_read on public.member_presence
  for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists member_presence_own_insert on public.member_presence;
create policy member_presence_own_insert on public.member_presence
  for insert with check (user_id = auth.uid());

drop policy if exists member_presence_own_update on public.member_presence;
create policy member_presence_own_update on public.member_presence
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists member_presence_own_delete on public.member_presence;
create policy member_presence_own_delete on public.member_presence
  for delete using (user_id = auth.uid());

revoke all on public.member_presence from anon;
grant select, insert, update, delete on public.member_presence to authenticated;

comment on table public.member_presence is
  'One row per signed-in tab. Heartbeat, optional interaction time and expiry only - no IP, no device fingerprint, no page history, no content.';

-- ---- 2. Manual availability -----------------------------------------
-- Kept in its own table so a preference survives closing every tab, and so it
-- can expire without touching the session rows.
create table if not exists public.member_availability (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  availability text not null default 'available'
    check (availability in ('available', 'away', 'busy', 'dnd')),
  share_with_members boolean not null default false,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

alter table public.member_availability enable row level security;

drop policy if exists member_availability_own on public.member_availability;
create policy member_availability_own on public.member_availability
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Other members may see a preference ONLY when the member opted to share it.
drop policy if exists member_availability_shared_read on public.member_availability;
create policy member_availability_shared_read on public.member_availability
  for select using (
    share_with_members = true
    and expires_at > now()
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.status in ('active', 'accepted', 'pending')
    )
  );

revoke all on public.member_availability from anon;
grant select, insert, update, delete on public.member_availability to authenticated;

-- ---- 3. Owner-configurable thresholds -------------------------------
-- One row. Defaults match the published model; the CHECK bounds mirror
-- src/lib/presence/thresholds.ts so no path can store a value that would make
-- every member flicker offline or stay online for a week.
create table if not exists public.presence_settings (
  id integer primary key default 1 check (id = 1),
  heartbeat_interval_seconds integer not null default 30
    check (heartbeat_interval_seconds between 10 and 300),
  connection_timeout_seconds integer not null default 90
    check (connection_timeout_seconds between 30 and 900),
  active_threshold_seconds integer not null default 120
    check (active_threshold_seconds between 30 and 900),
  idle_threshold_seconds integer not null default 600
    check (idle_threshold_seconds between 60 and 3600),
  session_expiration_seconds integer not null default 3600
    check (session_expiration_seconds between 300 and 86400),
  presence_update_interval_seconds integer not null default 30
    check (presence_update_interval_seconds between 10 and 300),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.presence_settings (id) values (1) on conflict (id) do nothing;

alter table public.presence_settings enable row level security;

-- Every signed-in member needs the thresholds to render their own indicator.
drop policy if exists presence_settings_read on public.presence_settings;
create policy presence_settings_read on public.presence_settings
  for select using (auth.uid() is not null);

-- Only the Owner tunes them.
drop policy if exists presence_settings_owner_write on public.presence_settings;
create policy presence_settings_owner_write on public.presence_settings
  for update using (public.is_owner()) with check (public.is_owner());

revoke all on public.presence_settings from anon;
grant select on public.presence_settings to authenticated;
grant update on public.presence_settings to authenticated;

comment on table public.presence_settings is
  'Owner-tunable presence thresholds. Bounds are CHECKed here and mirrored in code, so a bad value cannot be stored even by direct SQL.';

-- ---- 4. Heartbeat ----------------------------------------------------
-- Authenticated, server-authoritative. A heartbeat from an account that is not
-- allowed to sign in is REFUSED, so a suspended member cannot keep a session
-- alive (and cannot be revived by one).
create or replace function public.presence_heartbeat(
  p_session_id text,
  p_interacted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_expiry integer;
  v_sessions integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;
  if p_session_id is null or length(trim(p_session_id)) < 8 or length(p_session_id) > 64 then
    return jsonb_build_object('ok', false, 'error', 'invalid session');
  end if;

  select status into v_status from public.profiles where id = v_uid;
  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'no profile');
  end if;
  if v_status not in ('active', 'accepted', 'pending') then
    -- Delete whatever is left so a suspended account cannot look connected.
    delete from public.member_presence where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'account not permitted', 'state', 'offline');
  end if;

  select session_expiration_seconds into v_expiry from public.presence_settings where id = 1;
  v_expiry := coalesce(v_expiry, 3600);

  insert into public.member_presence
    (user_id, session_id, connection_state, last_heartbeat, last_interaction, expires_at)
  values (
    v_uid, p_session_id, 'connected', now(),
    case when coalesce(p_interacted, false) then now() else null end,
    now() + make_interval(secs => v_expiry)
  )
  on conflict (user_id, session_id) do update
    set connection_state = 'connected',
        last_heartbeat = now(),
        last_interaction = case when coalesce(p_interacted, false) then now()
                                else public.member_presence.last_interaction end,
        expires_at = now() + make_interval(secs => v_expiry),
        updated_at = now();

  select count(*) into v_sessions
    from public.member_presence
   where user_id = v_uid and expires_at > now();

  return jsonb_build_object('ok', true, 'state', 'connected', 'sessions', v_sessions);
end;
$$;

revoke all on function public.presence_heartbeat(text, boolean) from public, anon;
grant execute on function public.presence_heartbeat(text, boolean) to authenticated;

-- Explicit "I am leaving this tab" (sign-out, tab close). Best-effort by nature:
-- a browser that dies without warning leaves the row, which simply expires.
create or replace function public.presence_release(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;
  delete from public.member_presence
   where user_id = v_uid and session_id = p_session_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.presence_release(text) from public, anon;
grant execute on function public.presence_release(text) to authenticated;

-- ---- 5. Manual availability -----------------------------------------
create or replace function public.presence_set_availability(
  p_availability text,
  p_share_with_members boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_share boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;
  if p_availability is null or p_availability not in ('available', 'away', 'busy', 'dnd') then
    return jsonb_build_object('ok', false, 'error', 'Choose Available, Away, Busy or Do Not Disturb.');
  end if;

  select coalesce(p_share_with_members, share_with_members, false)
    into v_share from public.member_availability where user_id = v_uid;

  insert into public.member_availability (user_id, availability, share_with_members, updated_at, expires_at)
  values (v_uid, p_availability, coalesce(v_share, false), now(), now() + interval '24 hours')
  on conflict (user_id) do update
    set availability = p_availability,
        share_with_members = coalesce(p_share_with_members, public.member_availability.share_with_members, false),
        updated_at = now(),
        expires_at = now() + interval '24 hours';

  -- Mirror onto the live sessions so the directory reflects it immediately.
  update public.member_presence
     set manual_availability = p_availability, updated_at = now()
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'availability', p_availability);
end;
$$;

revoke all on function public.presence_set_availability(text, boolean) from public, anon;
grant execute on function public.presence_set_availability(text, boolean) to authenticated;

-- ---- 6. The directory read ------------------------------------------
-- Everything the Members page needs, in one staff-only call. Starts from
-- profiles (LEFT JOIN), so a member with no session, no phone and no presence
-- row still appears - a missing signal must never make an account vanish.
create or replace function public.network_directory()
returns table (
  o_user_id uuid,
  o_display_name text,
  o_email text,
  o_role text,
  o_status text,
  o_access_revoked_at timestamptz,
  o_onboarded boolean,
  o_can_request_invites boolean,
  o_created_at timestamptz,
  o_last_active_at timestamptz,
  o_assignment_count bigint,
  o_response_count bigint,
  o_subject_usage jsonb,
  o_phone text,
  o_phone_verified boolean,
  o_presence_state text,
  o_presence_sessions integer,
  o_presence_last_interaction timestamptz,
  o_manual_availability text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timeout integer;
  v_active integer;
  v_idle integer;
begin
  if not public.is_staff() then
    raise exception 'network_directory is owner/co-owner only' using errcode = '42501';
  end if;

  select connection_timeout_seconds, active_threshold_seconds, idle_threshold_seconds
    into v_timeout, v_active, v_idle
    from public.presence_settings where id = 1;
  v_timeout := coalesce(v_timeout, 90);
  v_active := coalesce(v_active, 120);
  v_idle := coalesce(v_idle, 600);

  return query
  select
    p.id::uuid,
    p.display_name::text,
    au.email::text,
    p.role::text,
    p.status::text,
    p.access_revoked_at::timestamptz,
    p.onboarded::boolean,
    p.can_request_invites::boolean,
    p.created_at::timestamptz,
    p.last_active_at::timestamptz,
    (select count(*) from public.assignments a where a.user_id = p.id)::bigint,
    (select count(*) from public.responses r where r.user_id = p.id)::bigint,
    coalesce((
      select jsonb_agg(jsonb_build_object('subject', t.subject, 'count', t.c))
      from (
        select a.subject, count(*) as c
          from public.assignments a
         where a.user_id = p.id and a.subject is not null
         group by a.subject
         order by c desc
      ) t
    ), '[]'::jsonb)::jsonb,
    coalesce(nullif(trim(p.phone), ''), nullif(trim(au.phone), ''))::text,
    (
      au.phone_confirmed_at is not null
      and au.phone is not null
      and coalesce(trim(p.phone), '') <> ''
      and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = regexp_replace(au.phone, '\D', '', 'g')
    )::boolean,
    -- Presence, decided by the server. Session-derived unless the member chose
    -- a manual state; an account that cannot sign in is always offline.
    case
      when p.status not in ('active', 'accepted', 'pending') then 'offline'
      when live.sessions is null or live.sessions = 0 then 'offline'
      when av.availability = 'dnd' then 'dnd'
      when av.availability = 'busy' then 'busy'
      when av.availability = 'away' then 'away'
      when live.last_interaction is not null
           and now() - live.last_interaction <= make_interval(secs => v_active) then 'active'
      when live.last_interaction is not null
           and now() - live.last_interaction <= make_interval(secs => v_idle) then 'idle'
      else 'online'
    end::text,
    coalesce(live.sessions, 0)::integer,
    live.last_interaction::timestamptz,
    coalesce(av.availability, null)::text
  from public.profiles p
  join auth.users au on au.id = p.id
  left join lateral (
    select count(*) as sessions, max(mp.last_interaction) as last_interaction
      from public.member_presence mp
     where mp.user_id = p.id and mp.expires_at > now()
       and mp.last_heartbeat > now() - make_interval(secs => v_timeout)
  ) live on true
  left join public.member_availability av
         on av.user_id = p.id and av.expires_at > now();
end;
$$;

revoke all on function public.network_directory() from public, anon;
grant execute on function public.network_directory() to authenticated;

comment on function public.network_directory() is
  'Staff-only member directory: membership metadata, verified-phone flag and server-computed presence. Never returns academic content.';
