-- =====================================================================
-- SOPHIRA migration 0022 — Notebook workspace (source-grounded
-- academic notebook, 2026-10-06 round)
--
-- RLS-CRITICAL, stricter than previous rounds: notebook SOURCES hold
-- uploaded private documents (teacher instructions, drafts, PDFs). Every
-- source is owned by EXACTLY ONE user. RLS prevents every OTHER user —
-- including admins — from reading source content: the ONLY policies
-- grant user_id = auth.uid(). There is NO admin/service-role read
-- policy on notebook_sources. (The server API also never reads with
-- the service role; it reads as the authenticated owner only.)
-- =====================================================================

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notebooks enable row level security;
create policy "notebooks_own_all" on public.notebooks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------
-- Sources. Exactly one owner. No other user — admin included — can
-- read. Controls (included/pinned/verified) are honest columns, not
-- free-text.
-- ------------------------------------------------------------------
create table if not exists public.notebook_sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,                    -- stable label shown in citations (S1, S2, ...)
  title text not null,
  source_type text not null check (source_type in
    ('pdf','docx','txt','web_url','image','teacher_instructions',
     'assignment_instructions','user_notes','research_source')),
  original_url text not null default '',
  canonical_url text not null default '',
  content_hash text not null default '',
  uploaded_at timestamptz not null default now(),
  retrieved_at timestamptz,
  extracted_text text not null default '',
  page_metadata jsonb not null default '[]'::jsonb,   -- [{page, chars_start, chars_end, label}] where available
  section_metadata jsonb not null default '[]'::jsonb, -- DOCX sections/paragraphs [{section, paragraph, chars_start, chars_end}] when available
  processing_status text not null default 'pending'
    check (processing_status in ('pending','processing','ready','failed','empty')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','partially_verified','failed','inaccessible')),
  included boolean not null default true,     -- source control: include
  pinned boolean not null default false,     -- source control: pin
  authority jsonb not null default '{}'::jsonb,  -- stored ranking decision (why selected)
  why_selected jsonb not null default '{}'::jsonb, -- {authority, relevance, date, source_type, reason, requirement_satisfied}
  retrieval_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notebook_id, source_id)
);

-- OWNER-ONLY RLS. Deliberately NO admin policy: every other user,
-- including admins, is blocked from reading source content.
alter table public.notebook_sources enable row level security;
create policy "notebook_sources_own_all" on public.notebook_sources
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists notebook_sources_notebook_idx
  on public.notebook_sources (notebook_id, included);

-- ------------------------------------------------------------------
-- Notes
-- ------------------------------------------------------------------
create table if not exists public.notebook_notes (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references public.notebook_sources(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notebook_notes enable row level security;
create policy "notebook_notes_own_all" on public.notebook_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------
-- Questions (notebook chat) — answers are grounded and LABELED
-- ------------------------------------------------------------------
create table if not exists public.notebook_questions (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer jsonb not null default '{}'::jsonb,  -- GroundedAnswer: statements w/ labels + inline citations
  allow_web_research boolean not null default false,
  status text not null default 'answered'
    check (status in ('pending','answered','failed')),
  created_at timestamptz not null default now()
);

alter table public.notebook_questions enable row level security;
create policy "notebook_questions_own_all" on public.notebook_questions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------
-- Evidence — exact passages with locators, labeled
-- ------------------------------------------------------------------
create table if not exists public.notebook_evidence (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.notebook_sources(id) on delete cascade,
  question_id uuid references public.notebook_questions(id) on delete set null,
  quote text not null,
  chars_start int,
  chars_end int,
  page int,
  section text,
  paragraph int,
  label text not null default 'SOURCE-SUPPORTED'
    check (label in ('SOURCE-SUPPORTED','INFERENCE','NOT VERIFIED')),
  created_at timestamptz not null default now()
);

alter table public.notebook_evidence enable row level security;
create policy "notebook_evidence_own_all" on public.notebook_evidence
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------
-- Artifacts — every generated artifact RETAINS SOURCE PROVENANCE
-- ------------------------------------------------------------------
create table if not exists public.notebook_artifacts (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  artifact_type text not null check (artifact_type in
    ('study_guide','quiz','flashcards','outline','briefing',
     'evidence_table','research_plan','essay_plan','bibliography')),
  title text not null default '',
  content jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb, -- per-section source ids + citations
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notebook_artifacts enable row level security;
create policy "notebook_artifacts_own_all" on public.notebook_artifacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
