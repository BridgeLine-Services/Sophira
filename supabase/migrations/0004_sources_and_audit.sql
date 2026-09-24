-- 0004: Source metadata, versioning audit trail, and structured academic sources.
--
-- Upgrade spec §6 (source management), §7 (priority/conflict handling),
-- §9 (robust versioning). All additions are non-destructive.

-- 1. Richer version audit trail (spec §9): what changed, why, and from where.
alter table public.profile_versions
  add column if not exists previous_values jsonb,   -- field-level diff: old values
  add column if not exists new_values jsonb,        -- field-level diff: new values
  add column if not exists assignment_id uuid references public.assignments(id) on delete set null,
  add column if not exists feedback_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists is_active boolean not null default true;

-- 2. Structured academic sources (spec §6).
--    Every source the student relies on — teacher docs, rubrics, examples,
--    corrections, course materials, student materials, AI interpretations —
--    can be registered here with full metadata. Authority is explicit so an
--    AI interpretation can NEVER silently become an official teacher rule.
create table if not exists public.academic_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  -- classification
  source_type text not null check (source_type in (
    'official_teacher_instruction', 'syllabus', 'rubric', 'worked_example',
    'teacher_correction', 'course_material', 'textbook', 'student_preference',
    'student_correction', 'student_example', 'ai_interpretation', 'ai_generated'
  )),
  title text not null,
  description text not null default '',
  content text not null default '',
  -- authority: higher number = more authoritative (see app priority order)
  authority int not null check (authority between 1 and 9),
  is_official boolean not null default false,
  origin text not null default 'student_upload',   -- student_upload | teacher_provided | ai_generated
  -- lifecycle
  status text not null default 'active' check (status in ('active', 'archived', 'superseded')),
  supersedes_source_id uuid references public.academic_sources(id) on delete set null,
  superseded_by_source_id uuid references public.academic_sources(id) on delete set null,
  -- dates
  source_date date,             -- when the material was issued/received
  effective_date date,           -- when it takes effect
  approval_status text not null default 'approved' check (approval_status in ('approved', 'pending', 'rejected')),
  confidence text not null default 'high' check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academic_sources_user_idx
  on public.academic_sources (user_id, status, source_type);

alter table public.academic_sources enable row level security;

create policy "Users manage only their own sources"
  on public.academic_sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
