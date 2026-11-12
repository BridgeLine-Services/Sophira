-- =====================================================================
-- 0048: FOUR MEMBERSHIP ROLES (2026-11-12)
--
-- Sophira shipped with two roles, owner and user. Everything in between had
-- to be expressed as "owner" (billing, security, other people's roles) or
-- "user" (nothing administrative), so the owner could not delegate a single
-- task without handing over the whole application.
--
-- ADDITIVE ONLY. Every existing profile keeps its row, its uuid, its name,
-- its email, its phone, its status, its timestamps and its role. Existing
-- owners stay owners; every existing user stays a user. Nobody is promoted.
--
-- This migration also closes a privilege hole that existed in the two-role
-- model: policy profiles_update_own lets a member update their own row, and
-- nothing stopped that row's `role` (or `status`) from being rewritten. A
-- guard trigger below now refuses any role/status/permission change made
-- from an ordinary signed-in session, so roles can only move through the
-- audited function at the bottom of this file.
-- =====================================================================

-- ---- 1. The role vocabulary -----------------------------------------
-- The inline check from 0001 is auto-named profiles_role_check.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'tester', 'co_owner', 'owner'));

-- Who last changed a role, and when. Additive; NULL for every existing row,
-- because we genuinely do not know who set the current values.
alter table public.profiles add column if not exists role_updated_at timestamptz;
alter table public.profiles add column if not exists role_updated_by uuid;

comment on column public.profiles.role is
  'One of user, tester, co_owner, owner. Enforced by profiles_role_check and only mutable through public.set_member_role().';

-- ---- 2. Staff helpers ------------------------------------------------
-- SECURITY DEFINER so a policy on profiles can ask about profiles without
-- recursing into that same policy. Closed allow-list: an unknown role is
-- never staff.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role in ('owner', 'co_owner')
       and p.status in ('active', 'accepted', 'pending')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'owner'
       and p.status in ('active', 'accepted', 'pending')
  );
$$;

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- ---- 3. Audit trail --------------------------------------------------
-- Append-only by construction: there is a SELECT policy for staff and no
-- INSERT/UPDATE/DELETE policy at all, so the only writer is this file's
-- SECURITY DEFINER function. No passwords, tokens or academic content is
-- ever recorded here.
create table if not exists public.membership_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  target_id uuid,
  action text not null,
  previous_role text,
  new_role text,
  success boolean not null default true,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists membership_audit_created_idx
  on public.membership_audit (created_at desc);
create index if not exists membership_audit_target_idx
  on public.membership_audit (target_id, created_at desc);

alter table public.membership_audit enable row level security;

drop policy if exists membership_audit_staff_read on public.membership_audit;
create policy membership_audit_staff_read on public.membership_audit
  for select using (public.is_staff());

revoke all on public.membership_audit from anon;
grant select on public.membership_audit to authenticated;

comment on table public.membership_audit is
  'Administrative membership actions (role changes) with actor, target, before/after and outcome. Append-only; readable by staff only.';

-- ---- 4. The guard that makes self-promotion impossible ---------------
-- profiles_update_own still lets a member edit their own profile, which is
-- correct for a display name. It must never let them edit their standing.
-- auth.uid() is NULL for the server's privileged channel (service role or
-- the verified direct connection), which is how the owner's revoke/restore
-- path legitimately writes; a signed-in session always carries a uid.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new; -- server-side channel (service role / direct verified connection)
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.can_request_invites is distinct from old.can_request_invites
     or new.access_revoked_at is distinct from old.access_revoked_at
     or new.role_updated_by is distinct from old.role_updated_by then
    if not exists (
      select 1 from public.profiles p
       where p.id = v_uid and p.role in ('owner', 'co_owner')
    ) then
      raise exception 'Only an Owner or Co-Owner can change a role, an account status or an invitation permission.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---- 5. The only sanctioned role change ------------------------------
-- One transaction: verify the caller, verify the target, apply the
-- last-Owner guard, write the change and record the audit row. Returning
-- jsonb (instead of raising) lets the API show the owner a plain sentence.
create or replace function public.set_member_role(
  p_target uuid,
  p_new_role text,
  p_confirm_owner boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_status text;
  v_target_role text;
  v_owner_count integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'You need to be signed in to change a role.');
  end if;

  select role, status into v_actor_role, v_actor_status
    from public.profiles where id = v_actor;
  if v_actor_role is null then
    return jsonb_build_object('ok', false, 'error', 'Your profile could not be read.');
  end if;
  if v_actor_role not in ('owner', 'co_owner') then
    return jsonb_build_object('ok', false, 'error', 'Only an Owner or Co-Owner can change a role.');
  end if;
  if v_actor_status not in ('active', 'accepted', 'pending') then
    return jsonb_build_object('ok', false, 'error', 'Your account cannot perform this action.');
  end if;

  select role into v_target_role
    from public.profiles where id = p_target for update;
  if v_target_role is null then
    return jsonb_build_object('ok', false, 'error', 'That member could not be found.');
  end if;

  if p_new_role is null or p_new_role not in ('user', 'tester', 'co_owner', 'owner') then
    return jsonb_build_object('ok', false, 'error', 'That is not one of Sophira''s four roles.');
  end if;

  if v_actor = p_target then
    return jsonb_build_object('ok', false, 'error', 'You cannot change your own role. Ask another Owner to do it.');
  end if;

  if p_new_role = v_target_role then
    return jsonb_build_object('ok', false, 'error', 'That member already has that role.');
  end if;

  if v_actor_role = 'co_owner' then
    if v_target_role in ('owner', 'co_owner') then
      return jsonb_build_object('ok', false, 'error', 'A Co-Owner cannot change an Owner or another Co-Owner.');
    end if;
    if p_new_role not in ('user', 'tester') then
      return jsonb_build_object('ok', false, 'error', 'A Co-Owner can only assign the User or Tester role.');
    end if;
  end if;

  if (p_new_role = 'owner' or v_target_role = 'owner') and not coalesce(p_confirm_owner, false) then
    return jsonb_build_object('ok', false, 'error',
      'Changing an Owner role needs an explicit confirmation. Nothing was changed.');
  end if;

  -- The last active Owner can never be demoted, deactivated or locked out.
  if v_target_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into v_owner_count
      from public.profiles
     where role = 'owner' and status in ('active', 'accepted', 'pending');
    if v_owner_count <= 1 then
      insert into public.membership_audit
        (actor_id, target_id, action, previous_role, new_role, success, failure_reason)
      values (v_actor, p_target, 'set_role', v_target_role, p_new_role, false,
              'Refused: this is the only active Owner.');
      return jsonb_build_object('ok', false, 'error',
        'This is the only Owner. Sophira will not leave the network without one, so this change was refused.');
    end if;
  end if;

  update public.profiles
     set role = p_new_role,
         role_updated_at = now(),
         role_updated_by = v_actor
   where id = p_target;

  insert into public.membership_audit
    (actor_id, target_id, action, previous_role, new_role, success, metadata)
  values (v_actor, p_target, 'set_role', v_target_role, p_new_role, true,
          jsonb_build_object('confirmed_owner_change', coalesce(p_confirm_owner, false)));

  return jsonb_build_object('ok', true, 'role', p_new_role, 'previous_role', v_target_role);
end;
$$;

revoke all on function public.set_member_role(uuid, text, boolean) from public, anon;
grant execute on function public.set_member_role(uuid, text, boolean) to authenticated;

comment on function public.set_member_role(uuid, text, boolean) is
  'The only sanctioned way to change a member role. Enforces actor authority, Co-Owner limits, self-promotion refusal and last-Owner protection in one transaction, and writes membership_audit.';

-- ---- 6. Suspension / removal must respect the last Owner -------------
-- The existing revoke/remove paths run over the privileged server channel.
-- Removing or revoking the final Owner would lock the network permanently,
-- so a trigger refuses it at the database, whatever the caller.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remaining integer;
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;

  -- Leaving the owner role, or leaving the usable statuses.
  if (new is not null and new.role = 'owner' and new.status in ('active', 'accepted', 'pending')) then
    return new; -- still a usable owner
  end if;

  select count(*) into v_remaining
    from public.profiles
   where role = 'owner'
     and status in ('active', 'accepted', 'pending')
     and id <> old.id;

  if v_remaining = 0 then
    raise exception 'This is the only Owner. Promote another Owner first, then change this one.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists profiles_guard_last_owner on public.profiles;
create trigger profiles_guard_last_owner
  before update or delete on public.profiles
  for each row execute function public.guard_last_owner();
