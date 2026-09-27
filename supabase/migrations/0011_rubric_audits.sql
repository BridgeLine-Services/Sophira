-- =====================================================================
-- SOPHIRA migration 0011 — rubric audits (spec §6)
--
-- Persists every rubric audit with the response it audited:
--   checklist  — the structured criteria parsed from the rubric/
--                 instructions/teacher docs (what was checked)
--   results     — per-criterion status/evidence/correction (what was found)
--   word_count  — deterministic word count of the audited draft
--   ai_assessed — TRUE when any criterion relied on semantic AI evaluation
--                 (never silently: results say so per criterion)
--
-- RLS: strictly per-user; one user's audits (and drafts' audit history)
-- are never visible to the owner or anyone else.
-- =====================================================================

create table if not exists public.rubric_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  response_id uuid not null references public.responses(id) on delete cascade,
  word_count int not null default 0,
  checklist jsonb not null default '{}',
  results jsonb not null default '{}',
  ai_assessed boolean not null default false,
  revision_of uuid references public.rubric_audits(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.rubric_audits enable row level security;

create policy "rubric_audits_own_all"
  on public.rubric_audits for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists rubric_audits_response_idx
  on public.rubric_audits (response_id, created_at desc);
create index if not exists rubric_audits_assignment_idx
  on public.rubric_audits (assignment_id, created_at desc);
