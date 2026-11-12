-- 0056: NETWORK ACTIVITY SERIES (2026-11-12). Per-day counts for the dashboard charts.
--
-- WHY A FUNCTION AND NOT A POLICY: sign-ups, study sessions and submitted answers live in
-- tables whose RLS is own-rows-only (profiles_select_own, work_sessions_own, responses_own).
-- A staff aggregate read straight from the browser would either see only the owner's own rows
-- or need a policy that lets staff read every member's work. Neither is acceptable.
--
-- So the member tables keep exactly the policies they have, and staff read a COUNT through this
-- one function. It is STABLE, SECURITY DEFINER, has a pinned search_path, refuses anyone who is
-- not staff, and returns counts only: no member id, no content, nothing finer than a day.
-- Applying it adds no data and changes no table; reversing it is one drop.

create or replace function public.network_activity_daily(p_days integer default 14)
returns table (
  day date,
  signups integer,
  study_sessions integer,
  answers integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_span integer;
  v_today date;
  v_start date;
begin
  if not public.is_staff() then
    raise exception 'network_activity_daily is owner/co-owner only' using errcode = '42501';
  end if;

  -- Bounded: a caller cannot ask for a decade and turn one panel into a table scan.
  v_span := greatest(1, least(90, coalesce(p_days, 14)));
  v_today := (now() at time zone 'utc')::date;
  v_start := v_today - (v_span - 1);

  return query
  with days as (
    select generate_series(v_start, v_today, interval '1 day')::date as d
  )
  select
    days.d as day,
    coalesce(s.signups, 0)::integer as signups,
    coalesce(w.sessions, 0)::integer as study_sessions,
    coalesce(r.answers, 0)::integer as answers
  from days
  left join (
    select (p.created_at at time zone 'utc')::date as d, count(*) as signups
      from public.profiles p
     where (p.created_at at time zone 'utc')::date between v_start and v_today
     group by 1
  ) s on s.d = days.d
  left join (
    select (ws.created_at at time zone 'utc')::date as d, count(*) as sessions
      from public.work_sessions ws
     where (ws.created_at at time zone 'utc')::date between v_start and v_today
     group by 1
  ) w on w.d = days.d
  left join (
    select (r.created_at at time zone 'utc')::date as d, count(*) as answers
      from public.responses r
     where (r.created_at at time zone 'utc')::date between v_start and v_today
     group by 1
  ) r on r.d = days.d
  order by days.d;
end;
$$;

revoke all on function public.network_activity_daily(integer) from public, anon;
grant execute on function public.network_activity_daily(integer) to authenticated;

comment on function public.network_activity_daily(integer) is
  'Staff-only per-day counts: accounts created, study sessions started, answers submitted. Counts only - no member ids and no content. Member tables keep their own-rows-only RLS.';
