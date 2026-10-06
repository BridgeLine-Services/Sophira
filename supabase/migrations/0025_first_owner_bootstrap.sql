-- SOPHIRA migration 0025: secure first-owner bootstrap (2026-10-06)
--
-- GOAL: the owner creates their owner account from the app itself, with no
-- manual database configuration (no app_config.owner_email insert, no
-- service-key editing) — while keeping the security contract of 0008:
--   * exactly ONE owner can ever exist;
--   * the winner is decided atomically by the DATABASE, not the browser;
--   * a second concurrent registration can NEVER also become owner;
--   * once an owner exists, bootstrap is permanently closed and every
--     further signup requires a valid invitation (unchanged path);
--   * no client (owner or otherwise) can read or modify the claim;
--   * the operator-configured owner_email restriction from 0008 is still
--     HONORED when it IS set: an unset value means the automatic
--     first-registration claim; a set value means only that email may
--     claim (operator intent preserved).
--
-- MECHANISM: public.owner_bootstrap is a single-row table (PRIMARY KEY id
-- with CHECK id = 1). The signup trigger attempts INSERT ... ON CONFLICT
-- DO NOTHING. Exactly one transaction in the system's lifetime succeeds;
-- every other registration finds the row present, receives found=false,
-- and falls through to the invitation-only path. A lost race therefore
-- CANNOT become owner. Raising an exception aborts the whole signup
-- transaction, so a rejected claim leaves no row behind.

create table if not exists public.owner_bootstrap (
  id         integer     primary key check (id = 1),
  claimed_at timestamptz not null default now(),
  claimed_by uuid        not null references auth.users(id)
);

-- No client API may read or write the claim. The trigger is SECURITY
-- DEFINER and the service role bypasses RLS; everyone else gets nothing.
revoke all on public.owner_bootstrap from anon, authenticated;
alter table public.owner_bootstrap enable row level security;

-- Seed: if this deployment already created an owner under the 0008 flow,
-- close the bootstrap window for that owner immediately (no second owner).
insert into public.owner_bootstrap (id, claimed_by)
select 1, p.id
  from public.profiles p
 where p.role = 'owner'
 order by p.created_at
 limit 1
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed_invitation uuid;
  v_owner_email text;
begin
  -- ---- First-owner bootstrap: a single atomic claim, ever --------------
  -- v_found is set by the INSERT below: only the FIRST successful
  -- registration in the database's lifetime can reach the owner branch.
  if not exists (select 1 from public.profiles where role = 'owner') then
    insert into public.owner_bootstrap (id, claimed_by) values (1, new.id)
      on conflict (id) do nothing;
    if found then
      -- Operator intent: a CONFIGURED owner_email still restricts the
      -- claim to that exact email (0008 contract). An UNSET value means
      -- the automatic first-registration bootstrap: the first person to
      -- complete registration becomes the owner and the window closes.
      select coalesce(value #>> '{}', '') into v_owner_email
        from public.app_config where key = 'owner_email';
      if v_owner_email is null or v_owner_email = ''
          or lower(v_owner_email) = lower(new.email) then
        insert into public.profiles (id, display_name, role)
        values (
          new.id,
          coalesce(new.raw_user_meta_data->>'display_name', ''),
          'owner'
        );
        return new;
      end if;
      -- Configured for a different email: abort the whole signup (the
      -- claim row rolls back with the transaction — never left behind).
      raise exception
        'Sophira is invitation-only. Sign-up requires an invitation for your email address.'
        using errcode = '28000';
    end if;
  end if;

  -- ---- Everyone else: atomically claim a pending, unexpired invitation --
  -- (unchanged from migration 0008 — race-safe via FOR UPDATE SKIP LOCKED)
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
