-- =====================================================================
-- SOPHIRA migration 0020 — LONG-TERM STUDENT MEMORY (2026-10-05)
--
-- A structured academic memory layer, SEPARATE from:
--   * temporary conversational context (responses.messages jsonb —
--     per-conversation, never promoted automatically), and
--   * writing-style learning patterns (learning_patterns — kept
--     untouched; that system tracks stylistic mistakes/methods for
--     paced output, not academic profile facts).
--
-- student_memories = the student's ACADEMIC PROFILE as evidence-backed
-- hypotheses: goals, strengths, weaknesses, preferences, habits,
-- recurring misconceptions, strategies, motivation patterns, history.
-- NEVER a dump of every sentence the student says: every memory is
-- created with an origin (student_supplied | ai_inferred), and AI-
-- inferred memories carry structured EVIDENCE rows and a confidence
-- that moves up and down as new evidence arrives.
--
-- Architecture: structured relational data (queryable, filterable,
-- explainable). No vector store — embeddings would add nothing here:
-- retrieval matches on category/subject/status with transparent
-- ranking, and every selected memory is shown to the student with WHY.
-- =====================================================================

-- ---------------------------------------------------------------------
-- student_memories
-- ---------------------------------------------------------------------
create table if not exists public.student_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  category text not null check (category in (
    'goal', 'strength', 'weakness', 'learning_preference',
    'explanation_preference', 'study_habit', 'recurring_mistake',
    'conceptual_misunderstanding', 'academic_history',
    'subject_preference', 'motivation_pattern',
    'effective_strategy', 'ineffective_strategy'
  )),

  statement text not null,                    -- e.g. "Algebra weakness"
  details text not null default '',          -- human-readable expansion
  subject text,                              -- nullable: cross-subject
  subject_tags text[] not null default '{}', -- matching aid, lowercase

  confidence real not null default 0.3
    check (confidence >= 0 and confidence <= 1),

  -- Lifecycle: active (in use), monitoring (AI hypothesis under
  -- observation — never asserted as fact), improving (recent evidence
  -- contradicts the original hypothesis in the student's favor),
  -- contradicted (recent evidence disputes it), archived (kept for
  -- history, not retrieved), disabled (student turned it off),
  -- forgotten (soft-deleted; purgeable).
  status text not null default 'monitoring'
    check (status in ('active', 'monitoring', 'improving', 'contradicted',
                      'archived', 'disabled', 'forgotten')),

  improvement_trend text not null default '' check (improvement_trend in
    ('', 'improving', 'plateaued', 'regressing')),

  origin text not null check (origin in ('student_supplied', 'ai_inferred')),
  source text not null default '',            -- what produced it (route/tool)

  first_observed timestamptz not null default now(),
  last_observed timestamptz not null default now(),
  last_used_at timestamptz,                   -- last retrieved into an AI prompt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_memories_user_status_idx
  on public.student_memories (user_id, status);
create index if not exists student_memories_user_category_idx
  on public.student_memories (user_id, category);
create index if not exists student_memories_user_subject_idx
  on public.student_memories (user_id, subject);

alter table public.student_memories enable row level security;

-- STRICT own-row isolation: a user sees and manages ONLY their own
-- memories. The owner is NOT exempt — RLS applies equally to every
-- role (the owner manages membership, never academic content).
create policy "student_memories_own_all"
  on public.student_memories for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- student_memory_evidence — structured evidence behind each memory
-- ---------------------------------------------------------------------
create table if not exists public.student_memory_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid not null references public.student_memories(id) on delete cascade,

  evidence_type text not null check (evidence_type in (
    'incorrect_problem', 'conceptual_error', 'correct_solution',
    'improvement_signal', 'regression_signal', 'student_statement',
    'student_correction', 'assignment_result', 'exam_result',
    'ai_observation', 'contradiction'
  )),

  -- positive = supports the hypothesis; negative = contradicts it
  polarity text not null default 'positive' check (polarity in ('positive', 'negative')),

  summary text not null,                     -- "7 incorrect problems on factoring"
  evidence_ref jsonb not null default '{}',  -- {assignment_id?, response_id?, ...}
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists student_memory_evidence_memory_idx
  on public.student_memory_evidence (memory_id, observed_at desc);
create index if not exists student_memory_evidence_user_idx
  on public.student_memory_evidence (user_id);

alter table public.student_memory_evidence enable row level security;

create policy "student_memory_evidence_own_all"
  on public.student_memory_evidence for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
