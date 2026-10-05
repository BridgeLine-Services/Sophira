-- =====================================================================
-- SOPHIRA migration 0017 — PERSISTENT SCHEDULE EXECUTION STATE MACHINE
-- (2026-10-05)
--
-- Upgrades the deadline scheduler (0010, src/lib/scheduler.ts — the
-- scheduling CALCULATIONS are unchanged) with a server-side, persisted
-- execution state machine:
--
--   WORKING → BREAK_PENDING → BREAKING → NEXT_WORK_SESSION → …
--   (PAUSED from WORKING/BREAKING; COMPLETED / FAILED terminal)
--
-- The machine is deliberately TIME-STAMP driven, not timer-driven: there
-- is NO background computing while the app is closed. Every transition
-- is reconciled deterministically from the persisted timestamps when the
-- user reconnects (src/lib/schedule-execution.ts — pure, offline-tested).
-- Progress is never lost and the schedule never restarts incorrectly.
--
-- DUPLICATE PREVENTION: a partial unique index allows at most ONE live
-- execution per assignment; terminal rows (COMPLETED/FAILED) are kept for
-- history and do not block a fresh start.
-- =====================================================================

create table if not exists public.schedule_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  schedule_id uuid not null references public.work_schedules(id) on delete cascade,
  state text not null default 'NEXT_WORK_SESSION'
    check (state in ('WORKING', 'BREAK_PENDING', 'BREAKING', 'NEXT_WORK_SESSION',
                     'PAUSED', 'COMPLETED', 'FAILED')),
  session_index int not null default 0,         -- cursor into the persisted plan
  started_at timestamptz,                       -- current work session start
  expected_end_at timestamptz,                  -- current session's expected end
  break_started_at timestamptz,                 -- persisted when a break begins
  break_end_at timestamptz,
  paused_at timestamptz,
  paused_from text check (paused_from is null or paused_from in ('WORKING', 'BREAKING')),
  -- Work left in the CURRENT session (a session may be ended early; the
  -- un-worked remainder resumes instead of being lost or double-counted).
  current_session_remaining_seconds int not null default 0,
  accumulated_work_time int not null default 0,   -- seconds actually worked
  accumulated_break_time int not null default 0,  -- seconds of break taken
  remaining_work int not null default 0,           -- seconds of planned work left
  deadline timestamptz not null,
  urgency text not null check (urgency in ('relaxed', 'normal', 'urgent', 'extreme')),
  schedule_version int not null default 1,       -- bumped on every re-plan
  completed_at timestamptz,
  failure_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_executions enable row level security;
create policy "schedule_executions_own_all" on public.schedule_executions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists schedule_executions_user_idx
  on public.schedule_executions (user_id, assignment_id);

-- At most ONE live execution per assignment (duplicate work sessions are
-- structurally impossible; enforced by the database, not just the API).
create unique index if not exists schedule_executions_one_live
  on public.schedule_executions (assignment_id)
  where state in ('WORKING', 'BREAK_PENDING', 'BREAKING', 'NEXT_WORK_SESSION', 'PAUSED');
