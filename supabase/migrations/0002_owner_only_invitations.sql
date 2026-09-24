-- =====================================================================
-- SOPHIRA migration 0002 — invitations are OWNER-only
-- In 0001 the invitations RLS policy allowed any authenticated user to
-- create invitation rows. Restrict insert/update/delete to the owner role.
-- =====================================================================

drop policy if exists "invitations_owner_manage" on public.invitations;

create policy "invitations_owner_manage" on public.invitations
  for all
  using (
    invited_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  )
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- Profiles: allow a user to INSERT their own profile row as a safety net
-- (normally created by the signup trigger, but some flows bypass triggers).
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());
