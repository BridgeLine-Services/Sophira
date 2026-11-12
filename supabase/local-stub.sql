-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION STUB (2026-11-11) — NOT a migration, never applied to
-- Supabase. It recreates only the pieces Supabase provides for free, so the real
-- migration chain can be applied and checked on a throwaway PostgreSQL:
--
--   createdb sophira_verify
--   psql -d sophira_verify -f supabase/local-stub.sql
--   psql -d sophira_verify -v ON_ERROR_STOP=1 -f supabase/bootstrap-all.sql
--
-- The stub is deliberately minimal and honest: every function returns "no user"
-- or an empty claim set, so a query run against this database proves the SCHEMA,
-- never the production data or the real auth behaviour.
--
-- Why it exists: without it, applying the chain locally dies on
-- `schema "auth" does not exist`, then on the missing roles (anon, authenticated,
-- service_role), then on storage.foldername() and storage.filename(), then on
-- auth.users.raw_user_meta_data — four separate dead ends found the slow way.
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Roles Supabase creates for you.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;

-- auth schema: only the columns the migrations actually read.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  invited_at timestamptz,
  email_confirmed_at timestamptz,
  -- 2026-11-12: the real Supabase auth.users carries the login phone number and the
  -- provider's confirmation timestamp. Migration 0049 reads both to decide whether a
  -- number is VERIFIED or merely supplied, so the local stub must have the same
  -- columns or the migration cannot be verified honestly.
  phone text,
  phone_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

-- storage schema: the three helpers the storage policies call.
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $$ select string_to_array(name, '/') $$;
create or replace function storage.filename(name text) returns text language sql immutable
  as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable
  as $$ select split_part(name, '.', -1) $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
