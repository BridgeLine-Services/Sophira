-- =====================================================================
-- 0032: PROVIDER CONNECTIONS (Microsoft Word + Google Docs, 2026-10-11)
-- Stores each user's OAuth tokens for the connected document providers.
-- SECURITY MODEL: this table deliberately has NO RLS policies, which means
-- anon/authenticated roles are DENIED all access (Supabase default when
-- RLS is enabled without policies). Only the server-side service role —
-- used exclusively by /api/integrations/* routes — can read or write
-- tokens. Client code can never SELECT access tokens; the status routes
-- expose only booleans and labels, never token values.
-- Additive + reversible (dropping the table restores the prior schema).
-- =====================================================================

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  account_label text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.provider_connections enable row level security;
-- Intentionally NO policies: tokens are service-role-only.

create index if not exists provider_connections_user_idx
  on public.provider_connections (user_id, provider);
