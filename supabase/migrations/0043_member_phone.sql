-- 0043: MEMBER PHONE NUMBERS (2026-11-03)
-- Additive only. The owner could not reach a member except by email, and the
-- invite form's phone number was used to send one text and then discarded.
--
-- Privacy: a member's number is readable ONLY by that member and by the owner
-- (through network_member_phones(), which checks the caller's role). No other
-- member can read it, and no column here widens any existing RLS policy.

alter table public.profiles add column if not exists phone text;

-- Capture the number when the member supplies it during sign-up. The trigger
-- is replaced, never dropped, so existing sign-ups keep working unchanged.
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
        insert into public.profiles (id, display_name, phone, role)
        values (
          new.id,
          coalesce(new.raw_user_meta_data->>'display_name', ''),
      nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
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

  insert into public.profiles (id, display_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
      nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    'user'
  );
  return new;
end;
$$;

-- Owner-only directory supplement: (user_id, phone) for members who gave one.
create or replace function public.network_member_phones()
returns table (user_id uuid, phone text)
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'
  ) then
    raise exception 'owner only';
  end if;
  return query
    select p.id, p.phone
    from public.profiles p
    where p.phone is not null and p.phone <> '';
end;
$$;

revoke all on function public.network_member_phones() from anon;
grant execute on function public.network_member_phones() to authenticated;
