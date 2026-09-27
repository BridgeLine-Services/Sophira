-- =====================================================================
-- SOPHIRA migration 0010 — deadline-aware scheduling (spec §11)
--
-- src/lib/scheduler.ts (planSchedule) already computes deterministic
-- work/break plans with hard-bounded breaks [10s, 6h], urgency scaling,
-- and honest feasibility warnings (unit-tested, unchanged). This
-- migration adds the missing persistence + assignment deadline fields:
--
--   * assignments.due_at / estimated_work_minutes / urgency
--   * work_schedules: one persisted plan per assignment with status and
--     a session cursor for pause/resume. RLS: strictly per-user — the
--     owner can never see another member's schedules.
--
-- Times are stored as timestamptz (ISO-8601 UTC); the UI converts the
-- browser's datetime-local value, so deadlines are timezone-safe.
-- =====================================================================

alter table public.assignments
  add column if not exists due_at timestamptz,
  add column if not exists estimated_work_minutes int
    check (estimated_work_minutes is null or estimated_work_minutes > 0),
  add column if not exists urgency text not null default 'normal'
    check (urgency in ('relaxed', 'normal', 'urgent', 'extreme'));

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  deadline timestamptz not null,
  urgency text not null check (urgency in ('relaxed', 'normal', 'urgent', 'extreme')),
  estimated_work_minutes int not null check (estimated_work_minutes > 0),
  plan jsonb not null,                     -- serialized planSchedule() output
  status text not null default 'planned'
    check (status in ('planned', 'running', 'paused', 'done')),
  session_index int not null default 0,    -- cursor: next session to work on
  work_started_at timestamptz,             -- when the current work session began
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live schedule per assignment (re-planning replaces the row).
create unique index if not exists work_schedules_one_per_assignment
  on public.work_schedules (assignment_id);

alter table public.work_schedules enable row level security;

create policy "work_schedules_own_all"
  on public.work_schedules for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists work_schedules_user_idx
  on public.work_schedules (user_id, status);
