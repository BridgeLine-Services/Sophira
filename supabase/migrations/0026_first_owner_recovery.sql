-- SOPHIRA migration 0026: first-owner recovery + schema version marker
-- (2026-10-07, owner-setup automation round)
--
-- GOAL: make the first-owner experience self-healing WITHOUT weakening a
-- single control:
--   * a STALE auth user (created by an earlier failed/incomplete owner
--     attempt: the account exists in auth.users but no profiles row was
--     created) can be COMPLETED into the first owner — but only by that
--     user's own authenticated session, only through a database race-safe
--     claim, and only while no owner exists;
--   * the completion function is NOT callable by any browser client
--     (revoked from anon/authenticated; granted only to the server's
--     service role, which the app uses after verifying the session);
--   * the 0025 security contract is fully preserved: exactly one owner,
--     the database decides, invitation-only for everyone after.
--
-- sophira_meta: a tiny server-only key/value table so the application can
-- PROBE the applied schema version through normal (service-role) queries
-- — no SQL editor inspection, no pg_catalog access from the app.

create table if not exists public.sophira_meta (
  key   text primary key,
  value text not null
);

-- No client may read or write the schema marker (server-only).
revoke all on public.sophira_meta from anon, authenticated;
alter table public.sophira_meta enable row level security;

insert into public.sophira_meta (key, value)
values ('schema_version', '0026')
on conflict (key) do update set value = excluded.value;

-- ---- complete_first_owner(p_user_id) --------------------------------
-- Recovery path for a stale auth user with no profile. Called ONLY by the
-- server (service role) after verifying the caller's authenticated
-- session, with the caller's OWN user id. The function re-checks every
-- security condition inside the database transaction:
--   * the account must be a real auth.users row (no phantom owners);
--   * no owner may exist yet (owner creation closes permanently after);
--   * the user must not already have a profile (no role rewrites);
--   * the single-row owner_bootstrap claim is attempted atomically — a
--     concurrent winner makes THIS call fail (exactly one owner, ever).
create or replace function public.complete_first_owner(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No authentication account exists for this user.'
      using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'An owner already exists; owner creation is permanently closed.'
      using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This account already has a profile.'
      using errcode = '28000';
  end if;

  -- Same atomic claim as migration 0025: exactly one caller can ever
  -- insert this row; everyone else finds it present and fails safely.
  insert into public.owner_bootstrap (id, claimed_by) values (1, p_user_id)
    on conflict (id) do nothing;
  if not found then
    raise exception 'The owner slot was just claimed by another registration.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (p_user_id, '', 'owner');
end;
$$;

-- The recovery function is callable ONLY server-side (service role).
revoke all on function public.complete_first_owner(uuid) from anon, authenticated;
grant execute on function public.complete_first_owner(uuid) to service_role;
