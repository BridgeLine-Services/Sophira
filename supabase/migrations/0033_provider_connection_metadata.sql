-- =====================================================================
-- 0033: PROVIDER CONNECTION METADATA (multi-user identity round, 2026-10-11)
-- provider_connections gains the provider-side account identity and the
-- scopes the user actually granted, so every operation can be audited
-- against the RIGHT connected account. Tokens remain service-role-only
-- (RLS enabled, no client policies — unchanged from 0032).
-- Additive + reversible.
-- =====================================================================

alter table public.provider_connections
  add column if not exists provider_account_id text,
  add column if not exists granted_scopes text;
