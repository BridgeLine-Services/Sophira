-- =====================================================================
-- 0054: TESTER WORKSPACE + LEARNING GOALS (2026-11-12)
--
-- 0048 introduced the tester role in the vocabulary; this migration gives
-- it a real, isolated workspace to write to, and adds the personal
-- learning goals the User Dashboard presents ("My Learning Goals").
--
-- Privacy model:
--   qa_reports      - a tester reads/writes ONLY their own reports; staff
--                     (owner, co-owner) read all and move status. The
--                     is_staff() helper from 0048 keeps that check out of
--                     the profiles policy recursion.
--   learning_goals  - strictly private to their owner (user_id = auth.uid()),
--                     same pattern as courses/notebooks.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---- QA reports: bugs and feedback filed from the tester workspace ----
create table if not exists public.qa_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'bug' check (kind in ('bug', 'feedback', 'idea')),
  title text not null,
  area text default '',
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  steps text default '',
  expected text default '',
  actual text default '',
  status text not null default 'open' check (status in ('open', 'triaged', 'fixed', 'closed', 'declined')),
  resolution_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qa_reports enable row level security;

drop policy if exists "qa_reports_insert_own" on public.qa_reports;
create policy "qa_reports_insert_own" on public.qa_reports
  for insert with check (user_id = auth.uid());

drop policy if exists "qa_reports_select_own_or_staff" on public.qa_reports;
create policy "qa_reports_select_own_or_staff" on public.qa_reports
  for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists "qa_reports_update_staff" on public.qa_reports;
create policy "qa_reports_update_staff" on public.qa_reports
  for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists "qa_reports_delete_own" on public.qa_reports;
create policy "qa_reports_delete_own" on public.qa_reports
  for delete using (user_id = auth.uid());

drop trigger if exists qa_reports_touch on public.qa_reports;
create trigger qa_reports_touch before update on public.qa_reports
  for each row execute procedure public.touch_updated_at();

create index if not exists qa_reports_user_created_idx on public.qa_reports (user_id, created_at desc);
create index if not exists qa_reports_status_idx on public.qa_reports (status);

-- ---- Learning goals: the student's own objectives and progress ------
create table if not exists public.learning_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  detail text default '',
  target_date date,
  status text not null default 'active' check (status in ('active', 'achieved', 'paused')),
  progress int not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.learning_goals enable row level security;

drop policy if exists "learning_goals_own" on public.learning_goals;
create policy "learning_goals_own" on public.learning_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists learning_goals_touch on public.learning_goals;
create trigger learning_goals_touch before update on public.learning_goals
  for each row execute procedure public.touch_updated_at();

create index if not exists learning_goals_user_idx on public.learning_goals (user_id, created_at desc);
