-- =====================================================================
-- 0051: DIRECTORY PRIVACY AND CO-OWNER INVITATIONS (2026-11-12)
--
-- Two changes, both requested at owner level, both additive.
--
-- 1. ACADEMIC PRIVACY IN THE DIRECTORY.
--    network_directory() returned, for every member, how many assignments they
--    have, how many responses they have written, and a per-subject breakdown of
--    their coursework. That is private academic activity, and an administrative
--    directory has no business carrying it: the owner manages people, not their
--    essays. A subject breakdown in particular can reveal what a member is
--    studying and how much work they are doing.
--
--    The function's return type changes, and a return type cannot be replaced
--    in place, so it is dropped and recreated. Only the function is dropped:
--    no table, no row and no policy is touched.
--
-- 2. CO-OWNERS MAY INVITE PEOPLE.
--    Before this migration the invitations policy allowed only the owner, while
--    the published role table gave a Co-Owner the invitation screen. The owner
--    has decided the role table is right, so the policy is widened to staff -
--    carefully:
--      * an INSERT still requires invited_by = auth.uid(), so nobody can forge
--        an invitation in someone else's name. That per-issuer guarantee is the
--        part that must never be weakened;
--      * a non-staff member is refused outright, whatever they construct;
--      * staff can read and revoke any invitation, which is what managing the
--        list means, and is what a Co-Owner needs to spot a mistake.
--    The token lookup used by signup is untouched.
-- =====================================================================

-- ---- 1. Directory without academic content ---------------------------

drop function if exists public.network_directory();

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
  'Staff-only member directory: membership metadata, verified-phone flag and server-computed presence. Never returns academic content of any kind, not even counts.';

-- ---- 2. Invitations: owner and co-owner ------------------------------

drop policy if exists "invitations_owner_manage" on public.invitations;
drop policy if exists "invitations_staff_select" on public.invitations;
drop policy if exists "invitations_staff_insert" on public.invitations;
drop policy if exists "invitations_staff_update" on public.invitations;
drop policy if exists "invitations_staff_delete" on public.invitations;

-- Staff may see the whole invitation list, including whose invitation it is.
create policy "invitations_staff_select" on public.invitations
  for select using (public.is_staff());

-- Issuing is staff-only AND always in your own name: a forged invited_by fails.
create policy "invitations_staff_insert" on public.invitations
  for insert with check (public.is_staff() and invited_by = auth.uid());

create policy "invitations_staff_update" on public.invitations
  for update using (public.is_staff()) with check (public.is_staff());

create policy "invitations_staff_delete" on public.invitations
  for delete using (public.is_staff());

comment on table public.invitations is
  'Invitation-only onboarding. Owner and Co-Owners may issue and revoke; an invitation is always recorded against the person who issued it (invited_by = auth.uid()), and a member who is not staff is refused by every policy here.';
