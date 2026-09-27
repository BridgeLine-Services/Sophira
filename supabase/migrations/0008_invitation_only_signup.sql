-- =====================================================================
-- SOPHIRA migration 0008 — TRUE invitation-only signup (spec §12)
--
-- Before this migration, the only signup gate was client-side: the signup
-- page checked an invitation token in the browser, but anyone with the
-- Supabase project URL could call auth.signUp directly and create an
-- account (the handle_new_user trigger happily created a profile for
-- every auth.users row). The /api/invitations/accept route only marked
-- the invitation used AFTER the account already existed.
--
-- This migration moves the gate INTO the database, where it cannot be
-- bypassed by any client, script, or alternate signup path:
--
--   1. handle_new_user (AFTER INSERT ON auth.users) now REQUIRES a
--      pending, unexpired invitation tied to the registering email,
--      and atomically claims it (single-use, race-safe). If none exists
--      the trigger raises an exception — which aborts the auth.users
--      insert — so the account is never created.
--   2. The old "first person to sign up becomes owner" rule is REMOVED
--      (it let any stranger claim ownership of a fresh install). The
--      bootstrap is now fail-closed: the initial owner is the address
--      configured in public.app_config key 'owner_email', which only
--      someone with database access (the person deploying Sophira) can
--      set. If no owner_email is configured, the very first signup is
--      rejected with a clear operator-facing message.
--   3. Every later user requires an invitation, claimed atomically.
--
-- Existing deployments are unaffected: users who already have profiles
-- keep them (login never runs this trigger; only signup does).
--
-- AFTER RUNNING THIS MIGRATION the operator must run, once, in the
-- Supabase SQL editor (replacing the address with the owner's email):
--
--   insert into public.app_config (key, value)
--   values ('owner_email', to_jsonb('owner@example.com'::text))
--   on conflict (key) do update set value = excluded.value;
-- =====================================================================

-- ---------------------------------------------------------------------
-- app_config: operator-set configuration (no RLS policies => never
-- readable or writable through the client API; only the DB trigger,
-- which runs as security definer, may read it).
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  set_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- ---------------------------------------------------------------------
-- Invitation-only signup enforcement.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed_invitation uuid;
  v_owner_email text;
  v_is_first boolean;
begin
  v_is_first := not exists (select 1 from public.profiles);

  -- ---- Bootstrap: the configured owner may create the FIRST account ----
  if v_is_first then
    select coalesce(value #>> '{}', '') into v_owner_email
    from public.app_config where key = 'owner_email';

    if v_owner_email <> '' and lower(v_owner_email) = lower(new.email) then
      insert into public.profiles (id, display_name, role)
      values (
        new.id,
        coalesce(new.raw_user_meta_data->>'display_name', ''),
        'owner'
      );
      return new;
    end if;

    -- Fail closed: without a configured owner_email there is no secure way
    -- to decide who the first account belongs to, so the deployment is
    -- locked until the operator configures it (see header comment).
    if v_owner_email is null or v_owner_email = '' then
      raise exception
        'Sophira is not yet initialized: no owner email is configured. An operator must run: insert into public.app_config (key, value) values (''owner_email'', to_jsonb(''owner@example.com''::text));'
        using errcode = '55000';
    end if;
    raise exception
      'Sophira is invitation-only. Sign-up requires an invitation for your email address.'
      using errcode = '28000';
  end if;

  -- ---- Everyone else: atomically claim a pending, unexpired invitation --
  -- The UPDATE ... WHERE id = (select ... for update) claim is atomic and
  -- single-use: two concurrent signups cannot both win — the loser finds
  -- no pending invitation and is rejected.
  update public.invitations
     set status = 'accepted',
         accepted_at = now()
   where id = (
     select id from public.invitations
      where lower(email) = lower(new.email)
        and status = 'pending'
        and expires_at > now()
      order by created_at
      for update skip locked
      limit 1
   )
  returning id into v_claimed_invitation;

  if v_claimed_invitation is null then
    raise exception
      'Sophira is invitation-only. Sign-up requires a valid, unused invitation for your email address.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    'user'
  );
  return new;
end;
$$;

-- Re-arm the trigger definition (drop + create keeps it attached to the
-- same event, guaranteeing the new function body is used).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- Belt-and-braces: the accept API route already enforces single-use
-- atomically; the trigger above is now the primary gate. Nothing else
-- to change — invitations stay owner-managed via RLS (0002/0006).
-- ---------------------------------------------------------------------
