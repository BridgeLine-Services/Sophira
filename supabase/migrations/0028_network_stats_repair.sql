-- =====================================================================
-- SOPHIRA migration 0028: network_stats() structural repair (2026-10-08)
--
-- LIVE FINDING (owner dashboard): "Statistics are unavailable: structure
-- of query does not match function result type." That is the plpgsql
-- RETURN QUERY error raised when the function's declared RETURNS TABLE
-- does not match the query it executes. The previous definitions (0005
-- and 0019) declare OUT parameters whose NAMES collide with real column
-- names (user_id, email, role, status, created_at...) — a fragile
-- pattern: any plpgsql variable-substitution drift, column type change,
-- or partially applied chain version leaves the function structurally
-- broken at RUNTIME even though it created cleanly.
--
-- REPAIR: recreate the function with collision-PROOF out-parameter
-- names (o_*), explicit casts on every selected column, and a stable
-- 13-column contract that matches the owner UI (0019 contract: email +
-- access_revoked_at). Drop-first (a RETURNS TABLE change is not allowed
-- via CREATE OR REPLACE), then re-grant execute to authenticated.
-- Owner-only check, aggregate metadata only — NO academic content
-- (privacy boundary, workflow §22), both unchanged.
-- =====================================================================

drop function if exists public.network_stats();

create or replace function public.network_stats()
returns table (
  o_user_id uuid,
  o_display_name text,
  o_email text,
  o_role text,
  o_status text,
  o_access_revoked_at timestamptz,
  o_onboarded boolean,
  o_can_request_invites boolean,
  o_created_at timestamptz,
  o_last_active_at timestamptz,
  o_assignment_count bigint,
  o_response_count bigint,
  o_subject_usage jsonb
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
    p.id                                   ::uuid,
    p.display_name                         ::text,
    au.email                               ::text,
    p.role                                 ::text,
    p.status                               ::text,
    p.access_revoked_at                    ::timestamptz,
    p.onboarded                            ::boolean,
    p.can_request_invites                  ::boolean,
    p.created_at                           ::timestamptz,
    p.last_active_at                       ::timestamptz,
    (select count(*) from public.assignments a
      where a.user_id = p.id)              ::bigint,
    (select count(*) from public.responses r
      where r.user_id = p.id)              ::bigint,
    coalesce((
      select jsonb_agg(jsonb_build_object('subject', s.subject, 'count', s.c))
      from (
        select a.subject, count(*) as c
        from public.assignments a
        where a.user_id = p.id and a.subject is not null
        group by a.subject
        order by c desc
      ) s
    ), '[]'::jsonb)                        ::jsonb
  from public.profiles p
  join auth.users au on au.id = p.id;
end;
$$;

revoke all on function public.network_stats() from anon, authenticated;
grant execute on function public.network_stats() to authenticated;
