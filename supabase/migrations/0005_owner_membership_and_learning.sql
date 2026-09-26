-- =====================================================================
-- SOPHIRA migration 0005 — owner membership system, invitation requests,
-- learning/mistake lifecycle, and privacy-safe owner analytics.
--
-- Goals (workflow spec):
--   * Roles/routing: owners get an Owner Dashboard; revoked users get an
--     explicit Access Denied state enforced at middleware + API + RLS level.
--   * Invitation-request flow: a user may REQUEST an invitation for someone
--     else; only the OWNER can approve (which issues the invitation) or reject.
--     No user can ever create an invitation directly — enforced by RLS and
--     server-side authorization, not just hidden UI.
--   * Learning patterns: structured personal knowledge (recurring mistakes,
--     learned methods, preferences) with confidence, observation counts,
--     active/corrected/inactive states, scoped applicability, and recurrence
--     detection — state, not chat history.
--   * Owner analytics: a SECURITY DEFINER function returning AGGREGATE-ONLY
--     membership statistics. It never exposes another user's academic content;
--     all content tables keep their per-user RLS policies (owner cannot read
--     another user's essays, files, writing samples, teacher profiles, etc.).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. profiles: account status, activity tracking, invite-request permission
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'revoked')),
  add column if not exists last_active_at timestamptz,
  add column if not exists can_request_invites boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. invitation_requests: user-requested invitations, owner-decided
-- ---------------------------------------------------------------------
create table if not exists public.invitation_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text not null default '',
  decided_at timestamptz,
  invitation_id uuid references public.invitations(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invitation_requests_status_idx
  on public.invitation_requests (status, created_at desc);

alter table public.invitation_requests enable row level security;

-- A user can submit a request for themselves ONLY if they hold the
-- can_request_invites permission (owner-granted). A revoked user cannot.
create policy "invitation_requests_insert_permitted"
  on public.invitation_requests for insert
  with check (
    requester_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'user' and p.status = 'active'
        and p.can_request_invites = true
    )
  );

-- A requester can always see their own requests.
create policy "invitation_requests_requester_select"
  on public.invitation_requests for select
  using (requester_id = auth.uid());

-- The owner can see and decide every request.
create policy "invitation_requests_owner_select"
  on public.invitation_requests for select
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'owner')
  );

create policy "invitation_requests_owner_update"
  on public.invitation_requests for update
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'owner')
  );

-- No one but the owner can DELETE requests.
create policy "invitation_requests_owner_delete"
  on public.invitation_requests for delete
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'owner')
  );

-- ---------------------------------------------------------------------
-- 3. learning_patterns: structured personal learning state (mistakes,
--    methods, preferences) with confidence and lifecycle (workflow §10).
-- ---------------------------------------------------------------------
create table if not exists public.learning_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('mistake', 'method', 'preference', 'correction')),
  -- applicability scope — a pattern learned in calculus must not leak into biology
  scope text not null default 'global'
    check (scope in ('global', 'subject', 'course', 'teacher', 'assignment', 'task_type')),
  subject text,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  task_type text,
  description text not null,
  examples jsonb not null default '[]',           -- [{content, date}]
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'corrected', 'inactive',
                       'recurring', 'temporary', 'teacher_required')),
  first_observed timestamptz not null default now(),
  last_observed timestamptz not null default now(),
  observation_count int not null default 1,
  confidence real not null default 0.3 check (confidence >= 0 and confidence <= 1),
  source text not null default 'ai_observation'
    check (source in ('ai_observation', 'user', 'teacher')),
  correction_source text not null default '',     -- who said it was corrected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_patterns_user_idx
  on public.learning_patterns (user_id, kind, status);

alter table public.learning_patterns enable row level security;

create policy "learning_patterns_own" on public.learning_patterns
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger learning_patterns_touch before update on public.learning_patterns
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. feedback: richer, explicitly-scoped feedback kinds (workflow §15)
-- ---------------------------------------------------------------------
alter table public.feedback
  add column if not exists subject text,
  add column if not exists scope text not null default 'assignment'
    check (scope in ('global', 'subject', 'course', 'teacher', 'assignment', 'task_type')),
  add column if not exists pattern_id uuid references public.learning_patterns(id) on delete set null;

-- Widen the allowed feedback kinds. The old constraint name is the default
-- (<table>_<column>_check); drop by name if it exists, else find it dynamically.
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.feedback'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%kind%';
  if c is not null then
    execute format('alter table public.feedback drop constraint %I', c);
  end if;
end $$;

alter table public.feedback
  add constraint feedback_kind_check check (kind in (
    'approve', 'error', 'correction', 'teacher_corrected', 'different_method',
    'teacher_wanted', 'writing_pref', 'this_is_normal', 'no_longer_correct',
    'remember', 'forget', 'assignment_only', 'note'
  ));

-- ---------------------------------------------------------------------
-- 5. network_stats(): owner-only, AGGREGATE-ONLY membership analytics.
--    Deliberately returns NO academic content — no essays, files, prompts,
--    writing samples, or answers. Privacy boundary (workflow §22):
--    the owner manages membership and sees activity metadata only.
-- ---------------------------------------------------------------------
create or replace function public.network_stats()
returns table (
  user_id uuid,
  display_name text,
  role text,
  status text,
  onboarded boolean,
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
    raise exception 'Only the owner can view network statistics';
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.role,
    p.status,
    p.onboarded,
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
  from public.profiles p;
end;
$$;

grant execute on function public.network_stats() to authenticated;
