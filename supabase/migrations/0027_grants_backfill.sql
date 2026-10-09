-- =====================================================================
-- SOPHIRA migration 0027: table grants + profile backfill (2026-10-08)
--
-- ROOT CAUSE (live owner-account failure, 2026-10-08): the schema was
-- initialized over the direct Postgres channel by the first-launch
-- wizard. On current Supabase projects, objects created that way do NOT
-- inherit the classic anon/authenticated default privileges, and none
-- of migrations 0001-0026 contained explicit GRANTs. Result: every
-- authenticated PostgREST query failed with "permission denied for
-- table X" (surfaced as "Could not save: permission denied for table
-- writing_samples"), every profiles read returned an error treated as
-- "profile missing", and RLS policies could never even be evaluated.
-- This migration restores the grants contract the app was written for.
-- =====================================================================

-- >>> grants:begin (pinned byte-identical to GRANTS_SQL in src/lib/db-privileged.ts)
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Future objects created by the migration/maintenance roles inherit the
-- same contract, so this never regresses on a fresh database.
do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin', 'supabase_auth_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('alter default privileges for role %I in schema public grant select on tables to anon, authenticated', r);
        execute format('alter default privileges for role %I in schema public grant select, insert, update, delete on tables to authenticated', r);
        execute format('alter default privileges for role %I in schema public grant usage, select on sequences to anon, authenticated', r);
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end $$;
-- >>> grants:end

-- ---------------------------------------------------------------------
-- Profile backfill: every REAL auth user gets its profile row. A user
-- can only exist in auth.users if signup was approved (the
-- handle_new_user trigger creates the profile and refuses uninvited
-- signups) — so a missing profile is always a repair artifact, never an
-- uninvited account. Idempotent.
-- ---------------------------------------------------------------------
insert into public.profiles (id, display_name, role)
select u.id, coalesce(u.raw_user_meta_data->>'display_name', ''), 'user'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- Owner explicitness: if no owner profile exists (pre-trigger databases),
-- promote the earliest profile — ownership is never left ambiguous.
update public.profiles set role = 'owner'
 where not exists (select 1 from public.profiles where role = 'owner')
   and id = (select id from public.profiles order by created_at limit 1);

-- Keep the single-owner bootstrap claim consistent with the owner row.
insert into public.owner_bootstrap (id, claimed_by)
select 1, p.id from public.profiles p where p.role = 'owner'
on conflict (id) do nothing;
