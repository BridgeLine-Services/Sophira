-- =====================================================================
-- SOPHIRA migration 0023 — STAGED ESSAY PIPELINE
-- (2026-10-06)
--
-- Persists the staged essay workflow (analysis → rubric → teacher
-- requirements → research → evidence map → thesis → outline →
-- section drafts → audits → final verification → paced presentation).
--
-- NOTHING here is written per character: sections are stored ONCE per
-- section (the reveal itself is a local timer on the client). The user
-- approves or edits the outline before any drafting (outline_approved
-- gate enforced by the server route AND the pure pipeline engine).
--
-- Strict per-user RLS, same as every other Sophira table.
-- =====================================================================

create table if not exists public.essay_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  research_project_id uuid references public.research_projects(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  title text not null,
  question text not null,
  genre text not null default 'Essay',
  -- pipeline bookkeeping
  stage text not null default 'assignment_analysis'
    check (stage in ('assignment_analysis','rubric','teacher_requirements','research','evidence_map','thesis','outline','section_drafts','citation_audit','rubric_audit','style_audit','final_verification','paced_presentation','failed')),
  status text not null default 'planning'
    check (status in ('planning','awaiting_outline_approval','drafting','verified','failed')),
  -- the compact assignment plan (analysis, rubric, teacher requirements,
  -- selected sources + evidence, thesis, outline) — shown BEFORE drafting
  plan jsonb not null default '{}'::jsonb,
  outline jsonb not null default '[]'::jsonb,
  outline_approved boolean not null default false,
  -- one entry per section, written once per section draft (never per char)
  sections jsonb not null default '[]'::jsonb,
  final_verification jsonb,
  -- scheduling
  deadline timestamptz,
  break_preference_seconds int check (break_preference_seconds is null or (break_preference_seconds >= 10 and break_preference_seconds <= 21600)),
  output_mode text not null default 'calibrated'
    check (output_mode in ('instant','calibrated','slow','custom')),
  custom_wpm numeric check (custom_wpm is null or (custom_wpm >= 5 and custom_wpm <= 220)),
  schedule_verdict text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

alter table public.essay_sessions enable row level security;

drop policy if exists "Users read own essay sessions" on public.essay_sessions;
create policy "Users read own essay sessions" on public.essay_sessions
  for select using (auth.uid() = user_id);
drop policy if exists "Users insert own essay sessions" on public.essay_sessions;
create policy "Users insert own essay sessions" on public.essay_sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own essay sessions" on public.essay_sessions;
create policy "Users update own essay sessions" on public.essay_sessions
  for update using (auth.uid() = user_id);
drop policy if exists "Users delete own essay sessions" on public.essay_sessions;
create policy "Users delete own essay sessions" on public.essay_sessions
  for delete using (auth.uid() = user_id);
