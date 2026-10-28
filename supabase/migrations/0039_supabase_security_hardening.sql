-- ============================================================================
-- 0039: Supabase security advisor remediation (2026-10-15)
--
-- Addresses, without changing any behavior:
--   * function_search_path_mutable          -> explicit safe search paths
--   * anon_security_definer_function_executable
--   * authenticated_security_definer_function_executable
--     -> minimum-privilege execution grants per function, based on the ACTUAL
--        callers verified in the application code:
--          complete_first_owner   -> /api/complete-owner (service-role key)
--          get_invitation_by_token-> invitation signup (anonymous, required)
--          network_stats           -> /api/network/stats (authenticated owner;
--                                     the function also enforces owner-only)
--          handle_new_user         -> auth trigger (supabase_auth_admin only)
--          rls_auto_enable         -> administrative; not referenced anywhere
--                                     in the application -> dropped if present
--
-- ALTER FUNCTION ... SET is used instead of CREATE OR REPLACE so function
-- bodies, trigger behavior, and ownership are untouched.
-- ============================================================================

begin;

-- 1) touch_updated_at(): pin the search path (advisor: mutable search path).
alter function public.touch_updated_at() set search_path = pg_catalog;

-- 2) handle_new_user(): auth trigger on auth.users. It runs as the trusted
--    auth-admin role during signup; no client role ever needs EXECUTE.
alter function public.handle_new_user() set search_path = pg_catalog, public;
revoke execute on function public.handle_new_user() from PUBLIC, anon, authenticated;

-- 3) complete_first_owner(p_user_id uuid): one-time owner bootstrap. The
--    application calls it ONLY from /api/complete-owner using the
--    service-role key, and the function itself is atomic and single-use
--    (owner slot claimed once; refuses if any owner exists). Ordinary
--    clients must not be able to execute it at all.
alter function public.complete_first_owner(uuid) set search_path = pg_catalog, public;
revoke execute on function public.complete_first_owner(uuid) from PUBLIC, anon, authenticated;

-- 4) get_invitation_by_token(p_token text): anonymous lookup of ONE pending
--    invitation is genuinely required for invitation-only signup. Keep the
--    anon capability (scoped: pending-only, exact token, SECURITY DEFINER)
--    but remove the blanket PUBLIC grant.
alter function public.get_invitation_by_token(text) set search_path = pg_catalog, public;
revoke execute on function public.get_invitation_by_token(text) from PUBLIC;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- 5) network_stats(): owner-only aggregate (the function re-checks the
--    caller's role). Called by /api/network/stats with the signed-in
--    user's client -> authenticated needs EXECUTE; anon and PUBLIC do not.
alter function public.network_stats() set search_path = pg_catalog, public;
revoke execute on function public.network_stats() from PUBLIC, anon;
grant execute on function public.network_stats() to authenticated;

-- 6) rls_auto_enable(): an administrative helper that flips RLS on tables.
--    Nothing in the application or migrations invokes it; RLS belongs to
--    migrations/deployments. Clients must never execute it. If a copy
--    exists in this database, remove it (idempotent).
--    2BP01 fix: Supabase provisions an "ensure_rls" EVENT TRIGGER that calls
--    this function. Dropping the function first fails with
--    "cannot drop function ... because other objects depend on it".
--    Drop the dependent trigger first (IF EXISTS keeps this idempotent).
drop event trigger if exists ensure_rls;
drop function if exists public.rls_auto_enable();

commit;
