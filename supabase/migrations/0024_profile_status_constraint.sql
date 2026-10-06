-- =====================================================================
-- SOPHIRA migration 0024 — HOSTILE SECURITY AUDIT FIXES
-- (2026-10-06)
--
-- Finding: profiles.status check constraint is ('pending','accepted',
-- 'revoked'), but the owner's restore action (/api/network/members) sets
-- status='active' — which VIOLATES the constraint, so un-revoking a member
-- has been silently impossible (the update fails at the DB). The guard
-- must also be allow-list based (fail closed) for any status it does not
-- explicitly trust.
--
-- Fix: the constraint now allows every status the application actually
-- uses ('pending' — created at signup, 'active' — restored member,
-- 'accepted' — legacy) and the API guard trusts ONLY this list.
-- =====================================================================

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending','accepted','active','revoked'));
