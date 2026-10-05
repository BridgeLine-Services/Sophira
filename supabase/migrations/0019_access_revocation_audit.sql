-- =====================================================================
-- SOPHIRA migration 0019 — owner-controlled access: revocation audit trail
--
-- The access-control model already exists (0001 roles, 0005 status):
--   profiles.role   'owner' | 'user'  (first account = operator-set owner)
--   profiles.status 'active' | 'revoked' (revoked = blocked everywhere:
--   middleware redirects to /access-denied; every protected API route
--   checks status via requireUser before touching any data or AI call).
--
-- This migration ADDS the audit trail the owner UI needs, without
-- changing any existing policy, table, or permission:
--   profiles.access_revoked_at — WHEN access was revoked (NULL = active)
--
-- It also extends network_stats() (owner-only, membership-management RPC)
-- to return each member's email identifier and revocation timestamp so
-- the Access Management area can show: name, email, role, status, date
-- granted (created_at), date revoked (access_revoked_at).
-- Still returns ZERO academic content — no essays, files, prompts,
-- writing samples, or answers (privacy boundary, workflow §22).
-- =====================================================================

alter table public.profiles
  add column if not exists access_revoked_at timestamptz;

-- Owner-only membership view, extended with email + revocation date.
-- SECURITY: unchanged fail-closed owner check; aggregate metadata only.
create or replace function public.network_stats()
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  status text,
  access_revoked_at timestamptz,
  onboarded boolean,
  can_request_invites boolean,
  created_at timestamptz,
  last_active_at timestamptz,
  assignment_count bigint,
  response_count bigint,
  subject_usage jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'owner') then
    raise exception 'network_stats is owner-only' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.display_name,
    au.email,
    p.role,
    p.status,
    p.access_revoked_at,
    p.onboarded,
    p.can_request_invites,
    p.created_at,
    p.last_active_at,
    (select count(*) from public.assignments a where a.user_id = p.id),
    (select count(*) from public.responses r where r.user_id = p.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('subject', s.subject, 'count', s.c))
      from (
        select a.subject, count(*) as c
        from public.assignments a
        where a.user_id = p.id and a.subject is not null
        group by a.subject
        order by c desc
      ) s
    ), '[]'::jsonb)
  from public.profiles p
  join auth.users au on au.id = p.id;
end;
$$;

revoke all on function public.network_stats() from anon, authenticated;
grant execute on function public.network_stats() to authenticated;

-- ---------------------------------------------------------------------
-- revoke_all_sessions(target_user): service-role session kill.
-- Deletes every refresh token for the user, so all their sessions
-- (installed apps, open browsers, previously issued tokens) can no
-- longer refresh — combined with the middleware + API-guard status
-- checks, access is invalid the moment the owner revokes it.
-- EXECUTE restricted to the service role: only the owner-membership API
-- (which itself requires role = 'owner') can call this.
-- ---------------------------------------------------------------------
create or replace function public.revoke_all_sessions(target_user uuid)
returns void
language plpgsql
security definer set search_path = public, auth
as $$
begin
  delete from auth.refresh_tokens where user_id = target_user;
end;
$$;

revoke all on function public.revoke_all_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_all_sessions(uuid) to service_role;
