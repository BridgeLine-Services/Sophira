-- SOPHIRA COMPLETE DATABASE SETUP (regenerated 2026-10-28)
-- Applies every migration in order (0001_init.sql ... 0040_document_history.sql).
-- Run this SINGLE file once in the Supabase SQL editor for a fresh
-- installation. It is SAFE TO RUN MORE THAN ONCE: every table, index,
-- policy, trigger and constraint is guarded, so re-running is harmless.
-- After it succeeds, open https://sophira.vercel.app/create-owner and
-- create the owner account.
-- Regenerate with: npm run db:bootstrap-sql (never edit by hand)

-- ===================== 0001_init.sql =====================
-- =====================================================================
-- SOPHIRA - Private AI Academic Assistant
-- Initial schema. All user data is isolated with Row Level Security (RLS):
-- a signed-in user can only ever read/write rows where user_id = auth.uid().
-- Run this in the Supabase SQL editor (or supabase db push).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles: one row per user, id matches auth.users
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('owner','user')),
  academic_level text,
  explanation_level text,             -- e.g. 'simple','standard','advanced'
  answer_style text,
  formatting_pref text,
  learning_prefs jsonb default '{}',
  accessibility_prefs jsonb default '{}',
  preferred_language text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());
-- inserts happen via the trigger below (service role).

-- auto-create a profile when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    case when not exists (select 1 from public.profiles) then 'owner' else 'user' end
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- invitations: owner-controlled onboarding for a small private group
-- ---------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.invitations enable row level security;
drop policy if exists "invitations_owner_manage" on public.invitations;
create policy "invitations_owner_manage" on public.invitations
  for all using (invited_by = auth.uid()) with check (invited_by = auth.uid());

-- Anonymous lookup of ONE pending invitation by token is required for signup.
-- Exposed as a SECURITY DEFINER function instead of a permissive select policy.
create or replace function public.get_invitation_by_token(p_token text)
returns public.invitations
language sql
security definer set search_path = public
as $$
  select * from public.invitations
  where token = p_token and status = 'pending';
$$;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- teachers + teacher_profiles
-- teacher_profiles keeps sections explicitly separated:
--   official_* (from teacher), examples (teacher-provided worked examples),
--   corrections (graded feedback), and ai_notes (unconfirmed AI guesses).
-- ---------------------------------------------------------------------
create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text default '',
  created_at timestamptz not null default now()
);
alter table public.teachers enable row level security;
drop policy if exists "teachers_own" on public.teachers;
create policy "teachers_own" on public.teachers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  -- structured teacher requirements
  required_methods text default '',
  required_steps text default '',
  preferred_notation text default '',
  units_sig_figs text default '',
  formatting_requirements text default '',
  citation_requirements text default '',
  essay_structure text default '',
  lab_report_requirements text default '',
  preferred_terminology text default '',
  show_work_rules text default '',
  calculator_rules text default '',
  allowed_tools text default '',
  prohibited_tools text default '',
  -- official documents / rubrics with source references
  rubrics jsonb default '[]',              -- [{title, content, source, source_date}]
  official_instructions jsonb default '[]',-- [{title, content, source, source_date}]
  -- teacher-provided worked examples
  examples jsonb default '[]',             -- [{title, content, source, source_date}]
  -- feedback / corrections from graded work (confirmed by the student)
  corrections jsonb default '[]',           -- [{content, source, source_date}]
  -- AI-generated interpretations NOT yet confirmed (never treated as official)
  ai_notes jsonb default '[]',             -- [{note, proposed, status}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id)
);
alter table public.teacher_profiles enable row level security;
drop policy if exists "teacher_profiles_own" on public.teacher_profiles;
create policy "teacher_profiles_own" on public.teacher_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  subject text,
  academic_level text,
  institution text,
  term text,
  teacher_id uuid references public.teachers(id) on delete set null,
  instructions text default '',
  created_at timestamptz not null default now()
);
alter table public.courses enable row level security;
drop policy if exists "courses_own" on public.courses;
create policy "courses_own" on public.courses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- writing samples + writing profile
-- ---------------------------------------------------------------------
create table if not exists public.writing_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  genre text,                             -- essay, discussion post, lab report...
  course_id uuid references public.courses(id) on delete set null,
  academic_level text,
  sample_date date,
  representativeness text not null default 'neutral'
    check (representativeness in ('preferred','neutral','not_representative')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.writing_samples enable row level security;
drop policy if exists "writing_samples_own" on public.writing_samples;
create policy "writing_samples_own" on public.writing_samples
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.writing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary jsonb default '{}',   -- analyzed style patterns
  guidance text default '',     -- distilled writing guidance for the AI
  status text not null default 'draft' check (status in ('draft','approved')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.writing_profiles enable row level security;
drop policy if exists "writing_profiles_own" on public.writing_profiles;
create policy "writing_profiles_own" on public.writing_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- assignments, files, work sessions, responses
-- ---------------------------------------------------------------------
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  mode text not null default 'assignment'
    check (mode in ('learn','assignment','check','writing','study','explain','custom')),
  subject text,
  academic_level text,
  task_type text,
  output_type text,
  instructions_text text default '',
  status text not null default 'active'
    check (status in ('active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.assignments enable row level security;
drop policy if exists "assignments_own" on public.assignments;
create policy "assignments_own" on public.assignments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.assignment_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  file_name text not null,
  storage_path text not null,   -- private Supabase storage bucket path
  mime_type text,
  extracted_text text default '',
  extraction_confidence text default 'unprocessed'
    check (extraction_confidence in ('unprocessed','high','medium','low','failed')),
  extraction_notes text default '',
  created_at timestamptz not null default now()
);
alter table public.assignment_files enable row level security;
drop policy if exists "assignment_files_own" on public.assignment_files;
create policy "assignment_files_own" on public.assignment_files
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  mode text not null default 'assignment',
  messages jsonb default '[]',  -- [{role:'user'|'assistant', content, meta}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.work_sessions enable row level security;
drop policy if exists "work_sessions_own" on public.work_sessions;
create policy "work_sessions_own" on public.work_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  session_id uuid references public.work_sessions(id) on delete cascade,
  content text not null,
  mode text,
  verification jsonb default '{}',  -- {status, checks:[], warnings:[]}
  model_used text,
  created_at timestamptz not null default now()
);
alter table public.responses enable row level security;
drop policy if exists "responses_own" on public.responses;
create policy "responses_own" on public.responses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- feedback + profile_update_proposals (approval-controlled learning loop)
-- ---------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  response_id uuid references public.responses(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  kind text not null check (kind in ('approve','error','correction','teacher_wanted','writing_pref','note')),
  comment text default '',
  content text default '',
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "feedback_own" on public.feedback;
create policy "feedback_own" on public.feedback
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.profile_update_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('teacher','writing')),
  target_id uuid,                -- teacher id or writing profile id
  change_summary text not null,
  proposed_changes jsonb not null default '{}',  -- field -> new value
  context jsonb default '{}',    -- assignment/course/feedback ids
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.profile_update_proposals enable row level security;
drop policy if exists "profile_update_proposals_own" on public.profile_update_proposals;
create policy "profile_update_proposals_own" on public.profile_update_proposals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- study_materials: personal library
-- ---------------------------------------------------------------------
create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in
    ('assignment','course','teacher_instructions','worked_example','writing_sample',
     'writing_profile','study_guide','practice_question','note','ai_response','correction')),
  title text not null,
  content text default '',
  tags text[] default '{}',
  assignment_id uuid references public.assignments(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.study_materials enable row level security;
drop policy if exists "study_materials_own" on public.study_materials;
create policy "study_materials_own" on public.study_materials
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Private storage bucket for uploaded documents
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('private-docs', 'private-docs', false)
  on conflict (id) do nothing;

-- Users can manage files ONLY inside their own uid folder.
drop policy if exists "private_docs_own_select" on storage.objects;
create policy "private_docs_own_select" on storage.objects
  for select using (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "private_docs_own_insert" on storage.objects;
create policy "private_docs_own_insert" on storage.objects
  for insert with check (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "private_docs_own_update" on storage.objects;
create policy "private_docs_own_update" on storage.objects
  for update using (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "private_docs_own_delete" on storage.objects;
create policy "private_docs_own_delete" on storage.objects
  for delete using (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute procedure public.touch_updated_at();
drop trigger if exists teacher_profiles_touch on public.teacher_profiles;
create trigger teacher_profiles_touch before update on public.teacher_profiles
  for each row execute procedure public.touch_updated_at();
drop trigger if exists writing_profiles_touch on public.writing_profiles;
create trigger writing_profiles_touch before update on public.writing_profiles
  for each row execute procedure public.touch_updated_at();
drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch before update on public.assignments
  for each row execute procedure public.touch_updated_at();
drop trigger if exists work_sessions_touch on public.work_sessions;
create trigger work_sessions_touch before update on public.work_sessions
  for each row execute procedure public.touch_updated_at();

-- ===================== 0002_owner_only_invitations.sql =====================
-- =====================================================================
-- SOPHIRA migration 0002 — invitations are OWNER-only
-- In 0001 the invitations RLS policy allowed any authenticated user to
-- create invitation rows. Restrict insert/update/delete to the owner role.
-- =====================================================================

drop policy if exists "invitations_owner_manage" on public.invitations;

drop policy if exists "invitations_owner_manage" on public.invitations;
create policy "invitations_owner_manage" on public.invitations
  for all
  using (
    invited_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  )
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- Profiles: allow a user to INSERT their own profile row as a safety net
-- (normally created by the signup trigger, but some flows bypass triggers).
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- ===================== 0003_profile_versions_and_context.sql =====================
-- 0003: Profile versioning, rollback support, and applied-context transparency.
--
-- Goals (spec §14, §22, §30):
--   * Every approved Teacher/Writing profile change snapshots the previous state.
--   * Students can view what changed and roll back to any previous version.
--   * Every AI response records which academic context was ACTUALLY applied
--     (teacher rules, course, writing profile, sources, conflicts) so the UI can
--     show real backend state, never a fabricated badge.

-- 1. Append-only profile version history (snapshots of the previous approved state).
create table if not exists public.profile_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('teacher', 'writing')),
  target_id uuid not null,          -- teacher_profiles.id or writing_profiles.id
  version int not null,            -- the version this snapshot represents
  change_summary text not null default '',
  source text not null default '', -- e.g. 'proposal:<id>' or 'rollback'
  approved_by uuid not null references public.profiles(id),
  snapshot jsonb not null,         -- full previous state, enabling rollback
  created_at timestamptz not null default now()
);

create index if not exists profile_versions_target_idx
  on public.profile_versions (user_id, target_type, target_id, created_at desc);

alter table public.profile_versions enable row level security;

drop policy if exists "Users manage only their own profile versions" on public.profile_versions;
create policy "Users manage only their own profile versions"
  on public.profile_versions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Writing profile change summaries (spec §14: change summary + source of change).
alter table public.writing_profiles
  add column if not exists change_summary text not null default '';

-- 3. Teacher profile versioning columns (spec §14).
alter table public.teacher_profiles
  add column if not exists version int not null default 1,
  add column if not exists change_summary text not null default '';

-- 4. Record what was ACTUALLY applied for each AI response (spec §40 honesty).
alter table public.responses
  add column if not exists context_applied jsonb;

-- context_applied shape:
-- {
--   "teacher": {"name": "...", "applied": true, "sources_used": [...], "fields_applied": [...]},
--   "course": {"name": "...", "applied": true},
--   "writing_profile": {"applied": false, "reason": "not a writing task"},
--   "classification": {...},
--   "conflicts": [{"a": "...", "b": "...", "detail": "..."}],
--   "verification_method": "computational" | "self_check" | "none"
-- }

-- ===================== 0004_sources_and_audit.sql =====================
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

drop policy if exists "Users manage only their own sources" on public.academic_sources;
create policy "Users manage only their own sources"
  on public.academic_sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===================== 0005_owner_membership_and_learning.sql =====================
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
drop policy if exists "invitation_requests_insert_permitted" on public.invitation_requests;
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
drop policy if exists "invitation_requests_requester_select" on public.invitation_requests;
create policy "invitation_requests_requester_select"
  on public.invitation_requests for select
  using (requester_id = auth.uid());

-- The owner can see and decide every request.
drop policy if exists "invitation_requests_owner_select" on public.invitation_requests;
create policy "invitation_requests_owner_select"
  on public.invitation_requests for select
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'owner')
  );

drop policy if exists "invitation_requests_owner_update" on public.invitation_requests;
create policy "invitation_requests_owner_update"
  on public.invitation_requests for update
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'owner')
  );

-- No one but the owner can DELETE requests.
drop policy if exists "invitation_requests_owner_delete" on public.invitation_requests;
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

drop policy if exists "learning_patterns_own" on public.learning_patterns;
create policy "learning_patterns_own" on public.learning_patterns
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists learning_patterns_touch on public.learning_patterns;
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

alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check check (kind in (
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
  can_request_invites boolean,
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
    p.can_request_invites,
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

-- ===================== 0006_invitation_expiry.sql =====================
-- =====================================================================
-- SOPHIRA migration 0006 — invitation expiry (workflow §5)
--
-- Invitation tokens must be single-use, tied to the invited email, AND
-- expirable/revocable. Revocation existed (0001); this adds EXPIRY:
--   - every invitation gets expires_at (default: 14 days after creation)
--   - the security-definer token lookup refuses expired invitations, so
--     expiry is enforced at the DATABASE level, not just hidden in the UI
--   - the accept route independently re-checks expiry (defense in depth)
-- =====================================================================

alter table public.invitations
  add column if not exists expires_at timestamptz not null default (now() + interval '14 days');

-- Existing pending invitations keep a full 14-day window from migration time.
-- (Adding a NOT NULL column with a default backfills every existing row.)

create or replace function public.get_invitation_by_token(p_token text)
returns public.invitations
language sql
security definer set search_path = public
as $$
  select * from public.invitations
  where token = p_token
    and status = 'pending'
    and expires_at > now();
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- ===================== 0007_intentional_habits.sql =====================
-- =====================================================================
-- SOPHIRA migration 0007 — intentionally preserved habits (workflow §12)
--
-- The workflow supports a nuance: a recurring mistake that is part of the
-- user's ESTABLISHED writing voice may be intentionally preserved when the
-- user explicitly asks the AI to reproduce their established style.
--
-- Safety rules (enforced in code, tested in tests/run.ts):
--   - the flag can ONLY be set by an explicit user action (corrections UI)
--   - it applies ONLY to writing tasks, and ONLY as style reproduction
--   - it NEVER overrides teacher/assignment requirements
--   - academic correctness in fresh work is unaffected — non-intentional
--     mistakes remain watch-for lines, never reproduced
-- =====================================================================

alter table public.learning_patterns
  add column if not exists intentional boolean not null default false;

-- ===================== 0008_invitation_only_signup.sql =====================
-- =====================================================================
-- SOPHIRA migration 0008 — TRUE invitation-only signup (spec §12)
--
-- Before this migration, the only signup gate was client-side: the signup
-- page checked an invitation token in the browser, but anyone with the
-- Supabase project URL could call auth.signUp directly and create an
-- account (the handle_new_user trigger happily created a profile for
-- every auth.users row). The /api/invitations/accept route only marked
-- the invitation used AFTER the account already existed.
--
-- This migration moves the gate INTO the database, where it cannot be
-- bypassed by any client, script, or alternate signup path:
--
--   1. handle_new_user (AFTER INSERT ON auth.users) now REQUIRES a
--      pending, unexpired invitation tied to the registering email,
--      and atomically claims it (single-use, race-safe). If none exists
--      the trigger raises an exception — which aborts the auth.users
--      insert — so the account is never created.
--   2. The old "first person to sign up becomes owner" rule is REMOVED
--      (it let any stranger claim ownership of a fresh install). The
--      bootstrap is now fail-closed: the initial owner is the address
--      configured in public.app_config key 'owner_email', which only
--      someone with database access (the person deploying Sophira) can
--      set. If no owner_email is configured, the very first signup is
--      rejected with a clear operator-facing message.
--   3. Every later user requires an invitation, claimed atomically.
--
-- Existing deployments are unaffected: users who already have profiles
-- keep them (login never runs this trigger; only signup does).
--
-- AFTER RUNNING THIS MIGRATION the operator must run, once, in the
-- Supabase SQL editor (replacing the address with the owner's email):
--
--   insert into public.app_config (key, value)
--   values ('owner_email', to_jsonb('owner@example.com'::text))
--   on conflict (key) do update set value = excluded.value;
-- =====================================================================

-- ---------------------------------------------------------------------
-- app_config: operator-set configuration (no RLS policies => never
-- readable or writable through the client API; only the DB trigger,
-- which runs as security definer, may read it).
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  set_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- ---------------------------------------------------------------------
-- Invitation-only signup enforcement.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed_invitation uuid;
  v_owner_email text;
  v_is_first boolean;
begin
  v_is_first := not exists (select 1 from public.profiles);

  -- ---- Bootstrap: the configured owner may create the FIRST account ----
  if v_is_first then
    select coalesce(value #>> '{}', '') into v_owner_email
    from public.app_config where key = 'owner_email';

    if v_owner_email <> '' and lower(v_owner_email) = lower(new.email) then
      insert into public.profiles (id, display_name, role)
      values (
        new.id,
        coalesce(new.raw_user_meta_data->>'display_name', ''),
        'owner'
      );
      return new;
    end if;

    -- Fail closed: without a configured owner_email there is no secure way
    -- to decide who the first account belongs to, so the deployment is
    -- locked until the operator configures it (see header comment).
    if v_owner_email is null or v_owner_email = '' then
      raise exception
        'Sophira is not yet initialized: no owner email is configured. An operator must run: insert into public.app_config (key, value) values (''owner_email'', to_jsonb(''owner@example.com''::text));'
        using errcode = '55000';
    end if;
    raise exception
      'Sophira is invitation-only. Sign-up requires an invitation for your email address.'
      using errcode = '28000';
  end if;

  -- ---- Everyone else: atomically claim a pending, unexpired invitation --
  -- The UPDATE ... WHERE id = (select ... for update) claim is atomic and
  -- single-use: two concurrent signups cannot both win — the loser finds
  -- no pending invitation and is rejected.
  update public.invitations
     set status = 'accepted',
         accepted_at = now()
   where id = (
     select id from public.invitations
      where lower(email) = lower(new.email)
        and status = 'pending'
        and expires_at > now()
      order by created_at
      for update skip locked
      limit 1
   )
  returning id into v_claimed_invitation;

  if v_claimed_invitation is null then
    raise exception
      'Sophira is invitation-only. Sign-up requires a valid, unused invitation for your email address.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    'user'
  );
  return new;
end;
$$;

-- Re-arm the trigger definition (drop + create keeps it attached to the
-- same event, guaranteeing the new function body is used).
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- Belt-and-braces: the accept API route already enforces single-use
-- atomically; the trigger above is now the primary gate. Nothing else
-- to change — invitations stay owner-managed via RLS (0002/0006).
-- ---------------------------------------------------------------------

-- ===================== 0009_typing_calibration.sql =====================
-- =====================================================================
-- SOPHIRA migration 0009 — typing calibration persistence (spec §9)
--
-- src/lib/typing.ts computes WPM / accuracy / net WPM from a raw attempt
-- (unit-tested, unchanged). This migration stores attempts and the
-- user-selected baseline with strict per-user RLS:
--
--   * every attempt is recomputed SERVER-SIDE from the submitted raw
--     attempt against the canonical reference passage (see
--     src/lib/typing-passage.ts) — the client only ever sends the typed
--     text and its own timestamps; the server derives and persists the
--     metrics, so a tampered client cannot store a fake speed.
--   * the typed text itself is NEVER stored (privacy: only the metrics).
--   * at most ONE baseline attempt per user is enforced by a partial
--     unique index, so "select baseline" is atomic and unambiguous.
--   * RLS: user_id = auth.uid() on every operation — the owner or any
--     other member can never read another user's typing history.
-- =====================================================================

create table if not exists public.typing_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_date timestamptz not null default now(),
  duration_ms bigint not null check (duration_ms > 0),
  characters_typed int not null check (characters_typed >= 0),
  wpm numeric not null check (wpm >= 0),
  accuracy numeric not null check (accuracy >= 0 and accuracy <= 1),
  net_wpm numeric not null check (net_wpm >= 0),
  valid_attempt boolean not null default false,
  flags text[] not null default '{}',
  is_baseline boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists typing_attempts_user_idx
  on public.typing_attempts (user_id, created_at desc);

-- At most one selected baseline per user.
create unique index if not exists typing_attempts_one_baseline
  on public.typing_attempts (user_id) where is_baseline;

alter table public.typing_attempts enable row level security;

drop policy if exists "typing_attempts_own_all" on public.typing_attempts;
create policy "typing_attempts_own_all"
  on public.typing_attempts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Baseline selection is done through the API route with a single
-- transactional UPDATE (clear the old baseline, set the new one) because
-- two statements from the client would briefly violate the unique index.
-- The route uses the user's own RLS-scoped client, so it stays per-user.

-- Atomic baseline selection: one statement pair inside a single function
-- call, invoker-security so RLS still applies. Only a VALID attempt owned
-- by the caller can become the baseline (an invalid/suspicious attempt
-- can never be selected).
create or replace function public.select_typing_baseline(p_attempt_id uuid)
returns void
language plpgsql
security invoker set search_path = public
as $$
begin
  update public.typing_attempts
     set is_baseline = false
   where user_id = auth.uid() and is_baseline;

  update public.typing_attempts
     set is_baseline = true
   where id = p_attempt_id and user_id = auth.uid() and valid_attempt = true;

  if not found then
    raise exception 'That attempt is not an eligible baseline (it must be a valid attempt of your own).'
      using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.select_typing_baseline(uuid) to authenticated;

-- ===================== 0010_deadline_scheduling.sql =====================
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

drop policy if exists "work_schedules_own_all" on public.work_schedules;
create policy "work_schedules_own_all"
  on public.work_schedules for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists work_schedules_user_idx
  on public.work_schedules (user_id, status);

-- ===================== 0011_rubric_audits.sql =====================
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

drop policy if exists "rubric_audits_own_all" on public.rubric_audits;
create policy "rubric_audits_own_all"
  on public.rubric_audits for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists rubric_audits_response_idx
  on public.rubric_audits (response_id, created_at desc);
create index if not exists rubric_audits_assignment_idx
  on public.rubric_audits (assignment_id, created_at desc);

-- ===================== 0012_research_tables.sql =====================
-- =====================================================================
-- SOPHIRA migration 0012 — verified web research (spec §§7-14)
--
-- RLS-critical: ALL research records belong to the authenticated user.
-- The owner can never browse another member's research: every policy is
-- user_id = auth.uid(). No service-role reads in app code.
-- =====================================================================

create table if not exists public.research_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  topic text not null,
  research_spec jsonb not null default '{}',   -- {academic_level, source_type, min_sources, date_range, citation_style, teacher_requirements, question}
  status text not null default 'searching'
    check (status in ('planning','searching','verified','writing','complete','failed')),
  failure_reason text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_projects enable row level security;
drop policy if exists "research_projects_own_all" on public.research_projects;
create policy "research_projects_own_all" on public.research_projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  query text not null,
  provider text not null default '',
  status text not null default 'pending'
    check (status in ('pending','ok','failed')),
  created_at timestamptz not null default now()
);

alter table public.research_queries enable row level security;
drop policy if exists "research_queries_own_all" on public.research_queries;
create policy "research_queries_own_all" on public.research_queries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  query_id uuid references public.research_queries(id) on delete set null,
  original_url text not null,
  final_url text not null default '',           -- URL after following redirects
  canonical_url text not null default '',      -- <link rel=canonical> when present
  domain text not null default '',
  title text not null default '',               -- page <title>, verified
  listed_title text not null default '',        -- title the search provider showed
  author text,                                  -- only when actually found (never invented)
  publisher text,
  publication_date date,                        -- only when actually found
  retrieval_date timestamptz not null default now(),
  source_type text not null default 'web',
  doi text,
  http_status int,
  redirect_count int not null default 0,
  verification_status text not null default 'unverified'
    check (verification_status in ('verified','partially_verified','unverified','failed','inaccessible')),
  verification_notes text not null default '',
  content_extract text not null default '',     -- retrieved text evidence (trusted only as data)
  content_chars int not null default 0,
  integrity_hash text not null default '',       -- sha256 of content at retrieval
  approval text not null default 'pending'
    check (approval in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.research_sources enable row level security;
drop policy if exists "research_sources_own_all" on public.research_sources;
create policy "research_sources_own_all" on public.research_sources
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists research_sources_project_idx
  on public.research_sources (project_id, verification_status);

create table if not exists public.research_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  response_id uuid references public.responses(id) on delete set null,
  claim text not null,
  source_id uuid references public.research_sources(id) on delete set null,
  evidence text not null default '',           -- exact extracted supporting text
  quote text,                                  -- verbatim quote from retrieved content
  location text,                               -- only when actually known (never invented)
  status text not null default 'missing'
    check (status in ('supported','partially_supported','unsupported','missing')),
  created_at timestamptz not null default now()
);

alter table public.research_claims enable row level security;
drop policy if exists "research_claims_own_all" on public.research_claims;
create policy "research_claims_own_all" on public.research_claims
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_citations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  response_id uuid references public.responses(id) on delete set null,
  source_id uuid not null references public.research_sources(id) on delete cascade,
  style text not null default 'generic',
  formatted_citation text not null,             -- generated from the SOURCE RECORD, never by the LLM
  created_at timestamptz not null default now()
);

alter table public.research_citations enable row level security;
drop policy if exists "research_citations_own_all" on public.research_citations;
create policy "research_citations_own_all" on public.research_citations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.research_sources(id) on delete cascade,
  checked_at timestamptz not null default now(),
  http_status int,
  final_url text not null default '',
  reachable boolean not null default false,
  content_chars int not null default 0,
  title_match boolean not null default false,
  notes text not null default '',
  status text not null default 'unverified'
    check (status in ('verified','partially_verified','unverified','failed','inaccessible'))
);

alter table public.research_verifications enable row level security;
drop policy if exists "research_verifications_own_all" on public.research_verifications;
create policy "research_verifications_own_all" on public.research_verifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists research_verifications_source_idx
  on public.research_verifications (source_id, checked_at desc);

-- ===================== 0013_claim_evidence.sql =====================
-- =====================================================================
-- SOPHIRA migration 0013 — full claim→evidence traceability
-- (research-integrity round, 2026-10-05)
--
-- Requirement: every substantive factual claim must trace
--   CLAIM → SOURCE → EXACT SUPPORTING PASSAGE → SOURCE URL → STATUS
-- and may be VERIFIED only when the retrieved content actually supports
-- it — never merely because the URL resolves / page exists / title
-- matches / domain is reputable.
--
-- The research_claims table (0012) already held claim/source/evidence/
-- status. This migration ADDS the required trace fields and the new
-- 'unverified' status (a claim whose source content is unavailable can
-- never be verified — it is marked unverified, never guessed). Existing
-- columns and values are untouched.
-- =====================================================================

alter table public.research_claims
  add column if not exists claim_id text not null default '',          -- stable server-assigned label (C1, C2, ...)
  add column if not exists assignment_id uuid references public.assignments(id) on delete set null,
  add column if not exists source_url text not null default '',        -- denormalized trace: URL the claim cites
  add column if not exists source_title text not null default '',     -- denormalized trace: verified page title
  add column if not exists evidence_start int,                        -- char offsets into stored content_extract
  add column if not exists evidence_end int,
  add column if not exists confidence real not null default 0,        -- deterministic 0..0.95, never 1.0
  add column if not exists authority_score int not null default 0,    -- deterministic 1..9 from the source record
  add column if not exists verified_at timestamptz,
  add column if not exists reasons jsonb not null default '[]'::jsonb; -- machine-readable verification reasons

-- Extend the status check with 'unverified' (source content unavailable /
-- no passage supplied — never guessed, never silently verified).
alter table public.research_claims
  drop constraint if exists research_claims_status_check;
alter table public.research_claims drop constraint if exists research_claims_status_check;
alter table public.research_claims add constraint research_claims_status_check
  check (status in ('supported','partially_supported','unsupported','missing','verified','unverified'));

-- Statuses stored by the new pipeline (verified/partially_supported/
-- unsupported/unverified) map onto the legacy values as: supported↔verified,
-- missing↔unverified. Both spellings are kept valid so historical rows
-- remain queryable.

create index if not exists research_claims_project_response_idx
  on public.research_claims (project_id, response_id);

-- Latest research-integrity report for a project (counts + failures +
-- research_complete), stored with the response id it belongs to.
alter table public.research_projects
  add column if not exists research_integrity jsonb;

-- ===================== 0014_source_authority.sql =====================
-- =====================================================================
-- SOPHIRA migration 0014 — assignment-aware source authority (2026-10-05)
--
-- The research ranking system now classifies each assignment/research
-- task (history, science, current events, literature, social science,
-- general) and applies a configurable authority profile whose tiers the
-- profile defines — teacher requirements always override generic
-- preferences, and .gov/.edu are never blindly prioritized.
--
-- The AUTHORITY DECISION for each selected source is stored with the
-- source, so the final citation audit can explain exactly WHY the
-- source was accepted (profile tier, teacher-requirement match,
-- peer-review status, primary/secondary, date fit, relevance,
-- evidence quality — with human-readable reasons).
-- =====================================================================

alter table public.research_sources
  add column if not exists authority_category text not null default '',
  add column if not exists authority_decision jsonb;

-- ===================== 0015_submission_gate.sql =====================
-- =====================================================================
-- SOPHIRA migration 0015 — FINAL SUBMISSION READINESS GATE (2026-10-05)
--
-- The mandatory final gate is machine-enforced: submission_ready is
-- false whenever ANY hard teacher/rubric/formatting/research/assignment
-- requirement fails. The evaluated gate result is persisted with the
-- draft it evaluated, so the UI can never display a stale or misleading
-- "Ready to Submit" state, and the exact blocking reasons stay on record.
-- =====================================================================

alter table public.responses
  add column if not exists submission_gate jsonb;

-- ===================== 0016_pattern_evidence.sql =====================
-- =====================================================================
-- SOPHIRA migration 0016 — PATTERN EVIDENCE, CONFIDENCE DECAY & THE
-- LOWER_CONFIDENCE STATUS (2026-10-05)
--
-- Upgrades the existing learning-pattern lifecycle (0005, workflow
-- §9–§12) WITHOUT replacing it. Adds the evidence-tracking columns the
-- confidence-decay engine (src/lib/learning/evidence.ts) needs and the
-- intermediate 'lower_confidence' status, so a pattern demotes
-- candidate → active → lower_confidence → inactive and can become
-- active again — it is never abruptly deleted.
--
-- Field mapping (requested → column):
--   pattern_id→id, user_id→user_id, pattern_type→kind,
--   pattern_scope→scope, confidence→confidence, created_at→created_at,
--   last_confirmed_at, last_used_at, observation_count,
--   confirmation_count, contradiction_count, correction_count, status.
-- =====================================================================

alter table public.learning_patterns
  add column if not exists last_confirmed_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists confirmation_count int not null default 0,
  add column if not exists contradiction_count int not null default 0,
  add column if not exists correction_count int not null default 0;

-- Status ladder gains the intermediate demotion step.
alter table public.learning_patterns
  drop constraint if exists learning_patterns_status_check;
alter table public.learning_patterns drop constraint if exists learning_patterns_status_check;
alter table public.learning_patterns add constraint learning_patterns_status_check check (
    status in ('candidate', 'active', 'corrected', 'inactive', 'recurring',
               'temporary', 'teacher_required', 'lower_confidence')
  );

-- ===================== 0017_schedule_executions.sql =====================
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
drop policy if exists "schedule_executions_own_all" on public.schedule_executions;
create policy "schedule_executions_own_all" on public.schedule_executions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists schedule_executions_user_idx
  on public.schedule_executions (user_id, assignment_id);

-- At most ONE live execution per assignment (duplicate work sessions are
-- structurally impossible; enforced by the database, not just the API).
create unique index if not exists schedule_executions_one_live
  on public.schedule_executions (assignment_id)
  where state in ('WORKING', 'BREAK_PENDING', 'BREAKING', 'NEXT_WORK_SESSION', 'PAUSED');

-- ===================== 0018_adaptive_typing_profile.sql =====================
-- =====================================================================
-- SOPHIRA migration 0018 — OPTIONAL ADAPTIVE TYPING PROFILE
-- (2026-10-05)
--
-- Upgrades the typing-speed system (0009: canonical passages, server-side
-- timing, WPM/accuracy/net-WPM, suspicious-attempt detection, user-selected
-- baseline, retesting — ALL unchanged) with an OPTIONAL adaptive profile.
--
-- Pacing NEVER changes automatically unless auto_adjust_enabled is true.
-- The user can keep the baseline fixed, enable adaptive pacing, retake
-- calibration, or manually select a preferred pace at any time.
--
-- Only VALID, unflagged attempts become observations: suspicious or
-- invalid timing data cannot corrupt the profile (filtered by the pure
-- engine src/lib/typing-profile.ts and never inserted as observations).
--
-- Strict per-user RLS, same as typing_attempts.
-- =====================================================================

create table if not exists public.typing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  baseline_wpm numeric not null check (baseline_wpm > 0),
  recent_average_wpm numeric not null check (recent_average_wpm >= 0),
  recommended_wpm numeric not null check (recommended_wpm > 0),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  sample_count int not null default 0 check (sample_count >= 0),
  last_calibration_at timestamptz,
  auto_adjust_enabled boolean not null default false,
  manual_wpm numeric check (manual_wpm is null or (manual_wpm > 0 and manual_wpm <= 220)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.typing_profiles enable row level security;

drop policy if exists "typing_profiles_own_all" on public.typing_profiles;
create policy "typing_profiles_own_all"
  on public.typing_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- One profile per user, enforced structurally.
create unique index if not exists typing_profiles_one_per_user
  on public.typing_profiles (user_id);

-- ===================== 0019_access_revocation_audit.sql =====================
-- =====================================================================
-- SOPHIRA migration 0019 — owner-controlled access: revocation audit trail
--
-- The access-control model already exists (0001 roles, 0005 status):
--   profiles.role   'owner' | 'user'  (first account = operator-set owner)
--   profiles.status 'active' | 'revoked' (revoked = blocked everywhere:
--   middleware redirects to /access-denied; every protected API route
--   checks status via requireUser before touching any data or AI call).
--
-- This migration ADDS the audit trail the owner UI needs, without
-- changing any existing policy, table, or permission:
--   profiles.access_revoked_at — WHEN access was revoked (NULL = active)
--
-- It also extends network_stats() (owner-only, membership-management RPC)
-- to return each member's email identifier and revocation timestamp so
-- the Access Management area can show: name, email, role, status, date
-- granted (created_at), date revoked (access_revoked_at).
-- Still returns ZERO academic content — no essays, files, prompts,
-- writing samples, or answers (privacy boundary, workflow §22).
-- =====================================================================

alter table public.profiles
  add column if not exists access_revoked_at timestamptz;

-- Owner-only membership view, extended with email + revocation date.
-- SECURITY: unchanged fail-closed owner check; aggregate metadata only.
-- Postgres cannot change a function's return type with CREATE OR REPLACE
-- (live-deployment finding 2026-10-07: the chain failed here with
-- "cannot change return type of existing function" whenever 0005's
-- original signature was already present). Drop first, then recreate;
-- the function body re-establishes the grants below, and the body's
-- owner-only check keeps the drop window safe.
drop function if exists public.network_stats();
create or replace function public.network_stats()
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  status text,
  access_revoked_at timestamptz,
  onboarded boolean,
  can_request_invites boolean,
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
    raise exception 'network_stats is owner-only' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.display_name,
    au.email,
    p.role,
    p.status,
    p.access_revoked_at,
    p.onboarded,
    p.can_request_invites,
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
  from public.profiles p
  join auth.users au on au.id = p.id;
end;
$$;

revoke all on function public.network_stats() from anon, authenticated;
grant execute on function public.network_stats() to authenticated;

-- ---------------------------------------------------------------------
-- revoke_all_sessions(target_user): service-role session kill.
-- Deletes every refresh token for the user, so all their sessions
-- (installed apps, open browsers, previously issued tokens) can no
-- longer refresh — combined with the middleware + API-guard status
-- checks, access is invalid the moment the owner revokes it.
-- EXECUTE restricted to the service role: only the owner-membership API
-- (which itself requires role = 'owner') can call this.
-- ---------------------------------------------------------------------
create or replace function public.revoke_all_sessions(target_user uuid)
returns void
language plpgsql
security definer set search_path = public, auth
as $$
begin
  delete from auth.refresh_tokens where user_id = target_user;
end;
$$;

revoke all on function public.revoke_all_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_all_sessions(uuid) to service_role;

-- ===================== 0020_student_memory.sql =====================
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
drop policy if exists "student_memories_own_all" on public.student_memories;
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

drop policy if exists "student_memory_evidence_own_all" on public.student_memory_evidence;
create policy "student_memory_evidence_own_all"
  on public.student_memory_evidence for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===================== 0021_provider_usage.sql =====================
-- =====================================================================
-- SOPHIRA migration 0021 — PROVIDER USAGE LOG (2026-10-06)
--
-- Server-side usage record for the owner provider-diagnostics screen.
-- Rows are written ONLY by API routes through the service-role client
-- (best-effort, never blocking an AI response). RLS is enabled with NO
-- policies: no client (owner included) can read or write through the
-- anon/authenticated role; only the service role (server) touches this
-- table. Contains NO user content and NO secrets — only provider id,
-- model, cost classification, success flag, and token counts.
-- =====================================================================

create table if not exists provider_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  classification text not null check (classification in ('local', 'free-tier', 'paid')),
  ok boolean not null,
  tokens_in integer,
  tokens_out integer
);

-- No client access at all — server/service-role only.
alter table provider_usage enable row level security;

create index if not exists provider_usage_created_at_idx on provider_usage (created_at desc);

-- ===================== 0022_notebooks.sql =====================
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
drop policy if exists "notebooks_own_all" on public.notebooks;
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
drop policy if exists "notebook_sources_own_all" on public.notebook_sources;
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
drop policy if exists "notebook_notes_own_all" on public.notebook_notes;
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
drop policy if exists "notebook_questions_own_all" on public.notebook_questions;
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
drop policy if exists "notebook_evidence_own_all" on public.notebook_evidence;
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
drop policy if exists "notebook_artifacts_own_all" on public.notebook_artifacts;
create policy "notebook_artifacts_own_all" on public.notebook_artifacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===================== 0023_essay_sessions.sql =====================
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
drop policy if exists "Users read own essay sessions" on public.essay_sessions;
create policy "Users read own essay sessions" on public.essay_sessions
  for select using (auth.uid() = user_id);
drop policy if exists "Users insert own essay sessions" on public.essay_sessions;
drop policy if exists "Users insert own essay sessions" on public.essay_sessions;
create policy "Users insert own essay sessions" on public.essay_sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own essay sessions" on public.essay_sessions;
drop policy if exists "Users update own essay sessions" on public.essay_sessions;
create policy "Users update own essay sessions" on public.essay_sessions
  for update using (auth.uid() = user_id);
drop policy if exists "Users delete own essay sessions" on public.essay_sessions;
drop policy if exists "Users delete own essay sessions" on public.essay_sessions;
create policy "Users delete own essay sessions" on public.essay_sessions
  for delete using (auth.uid() = user_id);

-- ===================== 0024_profile_status_constraint.sql =====================
-- =====================================================================
-- SOPHIRA migration 0024 — HOSTILE SECURITY AUDIT FIXES
-- (2026-10-06)
--
-- Finding: profiles.status check constraint is ('pending','accepted',
-- 'revoked'), but the owner's restore action (/api/network/members) sets
-- status='active' — which VIOLATES the constraint, so un-revoking a member
-- has been silently impossible (the update fails at the DB). The guard
-- must also be allow-list based (fail closed) for any status it does not
-- explicitly trust.
--
-- Fix: the constraint now allows every status the application actually
-- uses ('pending' — created at signup, 'active' — restored member,
-- 'accepted' — legacy) and the API guard trusts ONLY this list.
-- =====================================================================

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending','accepted','active','revoked'));

-- ===================== 0025_first_owner_bootstrap.sql =====================
-- SOPHIRA migration 0025: secure first-owner bootstrap (2026-10-06)
--
-- GOAL: the owner creates their owner account from the app itself, with no
-- manual database configuration (no app_config.owner_email insert, no
-- service-key editing) — while keeping the security contract of 0008:
--   * exactly ONE owner can ever exist;
--   * the winner is decided atomically by the DATABASE, not the browser;
--   * a second concurrent registration can NEVER also become owner;
--   * once an owner exists, bootstrap is permanently closed and every
--     further signup requires a valid invitation (unchanged path);
--   * no client (owner or otherwise) can read or modify the claim;
--   * the operator-configured owner_email restriction from 0008 is still
--     HONORED when it IS set: an unset value means the automatic
--     first-registration claim; a set value means only that email may
--     claim (operator intent preserved).
--
-- MECHANISM: public.owner_bootstrap is a single-row table (PRIMARY KEY id
-- with CHECK id = 1). The signup trigger attempts INSERT ... ON CONFLICT
-- DO NOTHING. Exactly one transaction in the system's lifetime succeeds;
-- every other registration finds the row present, receives found=false,
-- and falls through to the invitation-only path. A lost race therefore
-- CANNOT become owner. Raising an exception aborts the whole signup
-- transaction, so a rejected claim leaves no row behind.

create table if not exists public.owner_bootstrap (
  id         integer     primary key check (id = 1),
  claimed_at timestamptz not null default now(),
  claimed_by uuid        not null references auth.users(id)
);

-- No client API may read or write the claim. The trigger is SECURITY
-- DEFINER and the service role bypasses RLS; everyone else gets nothing.
revoke all on public.owner_bootstrap from anon, authenticated;
alter table public.owner_bootstrap enable row level security;

-- Seed: if this deployment already created an owner under the 0008 flow,
-- close the bootstrap window for that owner immediately (no second owner).
insert into public.owner_bootstrap (id, claimed_by)
select 1, p.id
  from public.profiles p
 where p.role = 'owner'
 order by p.created_at
 limit 1
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed_invitation uuid;
  v_owner_email text;
begin
  -- ---- First-owner bootstrap: a single atomic claim, ever --------------
  -- v_found is set by the INSERT below: only the FIRST successful
  -- registration in the database's lifetime can reach the owner branch.
  if not exists (select 1 from public.profiles where role = 'owner') then
    insert into public.owner_bootstrap (id, claimed_by) values (1, new.id)
      on conflict (id) do nothing;
    if found then
      -- Operator intent: a CONFIGURED owner_email still restricts the
      -- claim to that exact email (0008 contract). An UNSET value means
      -- the automatic first-registration bootstrap: the first person to
      -- complete registration becomes the owner and the window closes.
      select coalesce(value #>> '{}', '') into v_owner_email
        from public.app_config where key = 'owner_email';
      if v_owner_email is null or v_owner_email = ''
          or lower(v_owner_email) = lower(new.email) then
        insert into public.profiles (id, display_name, role)
        values (
          new.id,
          coalesce(new.raw_user_meta_data->>'display_name', ''),
          'owner'
        );
        return new;
      end if;
      -- Configured for a different email: abort the whole signup (the
      -- claim row rolls back with the transaction — never left behind).
      raise exception
        'Sophira is invitation-only. Sign-up requires an invitation for your email address.'
        using errcode = '28000';
    end if;
  end if;

  -- ---- Everyone else: atomically claim a pending, unexpired invitation --
  -- (unchanged from migration 0008 — race-safe via FOR UPDATE SKIP LOCKED)
  update public.invitations
     set status = 'accepted',
         accepted_at = now()
   where id = (
     select id from public.invitations
      where lower(email) = lower(new.email)
        and status = 'pending'
        and expires_at > now()
      order by created_at
      for update skip locked
      limit 1
   )
  returning id into v_claimed_invitation;

  if v_claimed_invitation is null then
    raise exception
      'Sophira is invitation-only. Sign-up requires a valid, unused invitation for your email address.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    'user'
  );
  return new;
end;
$$;

-- ===================== 0026_first_owner_recovery.sql =====================
-- SOPHIRA migration 0026: first-owner recovery + schema version marker
-- (2026-10-07, owner-setup automation round)
--
-- GOAL: make the first-owner experience self-healing WITHOUT weakening a
-- single control:
--   * a STALE auth user (created by an earlier failed/incomplete owner
--     attempt: the account exists in auth.users but no profiles row was
--     created) can be COMPLETED into the first owner — but only by that
--     user's own authenticated session, only through a database race-safe
--     claim, and only while no owner exists;
--   * the completion function is NOT callable by any browser client
--     (revoked from anon/authenticated; granted only to the server's
--     service role, which the app uses after verifying the session);
--   * the 0025 security contract is fully preserved: exactly one owner,
--     the database decides, invitation-only for everyone after.
--
-- sophira_meta: a tiny server-only key/value table so the application can
-- PROBE the applied schema version through normal (service-role) queries
-- — no SQL editor inspection, no pg_catalog access from the app.

create table if not exists public.sophira_meta (
  key   text primary key,
  value text not null
);

-- No client may read or write the schema marker (server-only).
revoke all on public.sophira_meta from anon, authenticated;
alter table public.sophira_meta enable row level security;

insert into public.sophira_meta (key, value)
values ('schema_version', '0026')
on conflict (key) do update set value = excluded.value;

-- ---- complete_first_owner(p_user_id) --------------------------------
-- Recovery path for a stale auth user with no profile. Called ONLY by the
-- server (service role) after verifying the caller's authenticated
-- session, with the caller's OWN user id. The function re-checks every
-- security condition inside the database transaction:
--   * the account must be a real auth.users row (no phantom owners);
--   * no owner may exist yet (owner creation closes permanently after);
--   * the user must not already have a profile (no role rewrites);
--   * the single-row owner_bootstrap claim is attempted atomically — a
--     concurrent winner makes THIS call fail (exactly one owner, ever).
create or replace function public.complete_first_owner(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No authentication account exists for this user.'
      using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'An owner already exists; owner creation is permanently closed.'
      using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This account already has a profile.'
      using errcode = '28000';
  end if;

  -- Same atomic claim as migration 0025: exactly one caller can ever
  -- insert this row; everyone else finds it present and fails safely.
  insert into public.owner_bootstrap (id, claimed_by) values (1, p_user_id)
    on conflict (id) do nothing;
  if not found then
    raise exception 'The owner slot was just claimed by another registration.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (p_user_id, '', 'owner');
end;
$$;

-- The recovery function is callable ONLY server-side (service role).
revoke all on function public.complete_first_owner(uuid) from anon, authenticated;
grant execute on function public.complete_first_owner(uuid) to service_role;

-- ===================== 0027_grants_backfill.sql =====================
-- =====================================================================
-- SOPHIRA migration 0027: table grants + profile backfill (2026-10-08)
--
-- ROOT CAUSE (live owner-account failure, 2026-10-08): the schema was
-- initialized over the direct Postgres channel by the first-launch
-- wizard. On current Supabase projects, objects created that way do NOT
-- inherit the classic anon/authenticated default privileges, and none
-- of migrations 0001-0026 contained explicit GRANTs. Result: every
-- authenticated PostgREST query failed with "permission denied for
-- table X" (surfaced as "Could not save: permission denied for table
-- writing_samples"), every profiles read returned an error treated as
-- "profile missing", and RLS policies could never even be evaluated.
-- This migration restores the grants contract the app was written for.
-- =====================================================================

-- >>> grants:begin (pinned byte-identical to GRANTS_SQL in src/lib/db-privileged.ts)
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Future objects created by the migration/maintenance roles inherit the
-- same contract, so this never regresses on a fresh database.
do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin', 'supabase_auth_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('alter default privileges for role %I in schema public grant select on tables to anon, authenticated', r);
        execute format('alter default privileges for role %I in schema public grant select, insert, update, delete on tables to authenticated', r);
        execute format('alter default privileges for role %I in schema public grant usage, select on sequences to anon, authenticated', r);
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end $$;
-- >>> grants:end

-- ---------------------------------------------------------------------
-- Profile backfill: every REAL auth user gets its profile row. A user
-- can only exist in auth.users if signup was approved (the
-- handle_new_user trigger creates the profile and refuses uninvited
-- signups) — so a missing profile is always a repair artifact, never an
-- uninvited account. Idempotent.
-- ---------------------------------------------------------------------
insert into public.profiles (id, display_name, role)
select u.id, coalesce(u.raw_user_meta_data->>'display_name', ''), 'user'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- Owner explicitness: if no owner profile exists (pre-trigger databases),
-- promote the earliest profile — ownership is never left ambiguous.
update public.profiles set role = 'owner'
 where not exists (select 1 from public.profiles where role = 'owner')
   and id = (select id from public.profiles order by created_at limit 1);

-- Keep the single-owner bootstrap claim consistent with the owner row.
insert into public.owner_bootstrap (id, claimed_by)
select 1, p.id from public.profiles p where p.role = 'owner'
on conflict (id) do nothing;

-- ===================== 0028_network_stats_repair.sql =====================
-- =====================================================================
-- SOPHIRA migration 0028: network_stats() structural repair (2026-10-08)
--
-- LIVE FINDING (owner dashboard): "Statistics are unavailable: structure
-- of query does not match function result type." That is the plpgsql
-- RETURN QUERY error raised when the function's declared RETURNS TABLE
-- does not match the query it executes. The previous definitions (0005
-- and 0019) declare OUT parameters whose NAMES collide with real column
-- names (user_id, email, role, status, created_at...) — a fragile
-- pattern: any plpgsql variable-substitution drift, column type change,
-- or partially applied chain version leaves the function structurally
-- broken at RUNTIME even though it created cleanly.
--
-- REPAIR: recreate the function with collision-PROOF out-parameter
-- names (o_*), explicit casts on every selected column, and a stable
-- 13-column contract that matches the owner UI (0019 contract: email +
-- access_revoked_at). Drop-first (a RETURNS TABLE change is not allowed
-- via CREATE OR REPLACE), then re-grant execute to authenticated.
-- Owner-only check, aggregate metadata only — NO academic content
-- (privacy boundary, workflow §22), both unchanged.
-- =====================================================================

drop function if exists public.network_stats();

create or replace function public.network_stats()
returns table (
  o_user_id uuid,
  o_display_name text,
  o_email text,
  o_role text,
  o_status text,
  o_access_revoked_at timestamptz,
  o_onboarded boolean,
  o_can_request_invites boolean,
  o_created_at timestamptz,
  o_last_active_at timestamptz,
  o_assignment_count bigint,
  o_response_count bigint,
  o_subject_usage jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'owner') then
    raise exception 'network_stats is owner-only' using errcode = '42501';
  end if;

  return query
  select
    p.id                                   ::uuid,
    p.display_name                         ::text,
    au.email                               ::text,
    p.role                                 ::text,
    p.status                               ::text,
    p.access_revoked_at                    ::timestamptz,
    p.onboarded                            ::boolean,
    p.can_request_invites                  ::boolean,
    p.created_at                           ::timestamptz,
    p.last_active_at                       ::timestamptz,
    (select count(*) from public.assignments a
      where a.user_id = p.id)              ::bigint,
    (select count(*) from public.responses r
      where r.user_id = p.id)              ::bigint,
    coalesce((
      select jsonb_agg(jsonb_build_object('subject', s.subject, 'count', s.c))
      from (
        select a.subject, count(*) as c
        from public.assignments a
        where a.user_id = p.id and a.subject is not null
        group by a.subject
        order by c desc
      ) s
    ), '[]'::jsonb)                        ::jsonb
  from public.profiles p
  join auth.users au on au.id = p.id;
end;
$$;

revoke all on function public.network_stats() from anon, authenticated;
grant execute on function public.network_stats() to authenticated;

-- ===================== 0029_study_materials_course.sql =====================
-- =====================================================================
-- SOPHIRA migration 0029: course-scoped Library (2026-10-09)
--
-- The course-engine workspace exposes a per-course Library view. The
-- existing study_materials schema could not scope a material to a course
-- (only assignment_id existed), so this adds an optional course_id.
--
-- PRIVACY: no RLS policy changes — "study_materials_own" (user_id =
-- auth.uid()) continues to govern every row. course_id only narrows the
-- user's OWN material set; it can never widen access to another user's
-- data. A null course_id + null assignment_id keeps a material global.
-- =====================================================================

alter table public.study_materials
  add column if not exists course_id uuid
  references public.courses(id) on delete set null;

create index if not exists idx_study_materials_course
  on public.study_materials (user_id, course_id)
  where course_id is not null;

-- ===================== 0030_subject_preferences.sql =====================
-- 0030: subject-level preferences (Foreign Language selector and any future
-- per-subject settings). Owned strictly by the authenticated user via RLS.
create table if not exists public.subject_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  target_language text,
  explanation_language text,
  proficiency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, subject)
);

alter table public.subject_preferences enable row level security;

drop policy if exists "subject_preferences_own_all" on public.subject_preferences;
create policy "subject_preferences_own_all"
  on public.subject_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.subject_preferences to authenticated;

-- ===================== 0031_student_memory_course_scope.sql =====================
-- =====================================================================
-- 0031: STUDENT MEMORY COURSE SCOPE (shared-memory round 2026-10-11)
-- Hierarchical memory, level 3 of 5: student_memories gains an explicit
-- course_id identifier so course-level memories can be recorded and
-- retrieved WITHOUT relying on display names or duplicated rows.
-- Additive + reversible (removing the column restores the prior schema).
-- RLS: unchanged — policies are user_id own-row, so course-scoped
-- rows inherit the same strict isolation automatically.
-- =====================================================================

alter table public.student_memories
  add column if not exists course_id uuid
    references public.courses(id) on delete set null;

-- A course-scoped memory is retrieved only inside that course (handled in
-- lib/memory/engine.ts relevance selection); never in another course or a
-- bare subject prompt.
create index if not exists student_memories_user_course_idx
  on public.student_memories (user_id, course_id);

-- ===================== 0032_provider_connections.sql =====================
-- =====================================================================
-- 0032: PROVIDER CONNECTIONS (Microsoft Word + Google Docs, 2026-10-11)
-- Stores each user's OAuth tokens for the connected document providers.
-- SECURITY MODEL: this table deliberately has NO RLS policies, which means
-- anon/authenticated roles are DENIED all access (Supabase default when
-- RLS is enabled without policies). Only the server-side service role —
-- used exclusively by /api/integrations/* routes — can read or write
-- tokens. Client code can never SELECT access tokens; the status routes
-- expose only booleans and labels, never token values.
-- Additive + reversible (dropping the table restores the prior schema).
-- =====================================================================

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  account_label text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.provider_connections enable row level security;
-- Intentionally NO policies: tokens are service-role-only.

create index if not exists provider_connections_user_idx
  on public.provider_connections (user_id, provider);

-- ===================== 0033_provider_connection_metadata.sql =====================
-- =====================================================================
-- 0033: PROVIDER CONNECTION METADATA (multi-user identity round, 2026-10-11)
-- provider_connections gains the provider-side account identity and the
-- scopes the user actually granted, so every operation can be audited
-- against the RIGHT connected account. Tokens remain service-role-only
-- (RLS enabled, no client policies — unchanged from 0032).
-- Additive + reversible.
-- =====================================================================

alter table public.provider_connections
  add column if not exists provider_account_id text,
  add column if not exists granted_scopes text;

-- ===================== 0034_workload_selections.sql =====================
-- =====================================================================
-- 0034: WORKLOAD SELECTIONS (document access + explicit scope, 2026-10-12)
-- A selection records WHICH provider document the AUTHENTICATED user
-- chose for a Sophira task, plus their EXPLICIT workload scope (section,
-- questions, deliverables). It is the boundary record for the personal
-- AI workload rule: Sophira processes only the authenticated member's
-- selected workload, never a non-member's work.
-- Owner-scoped like other private user records: RLS ON with
-- authenticated, owner-only policies (NOT service-role-only like
-- provider_connections 0032 — these rows carry no secrets; they carry
-- the user's own task choices and are needed by the user's own client).
-- Additive + reversible.
-- =====================================================================

create table if not exists public.workload_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  provider_document_id text not null,
  document_title text,
  document_url text,
  access_state text not null default 'unverified' check (access_state in ('unverified','read','write')),
  scope_description text,
  content_fingerprint text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_document_id)
);

alter table public.workload_selections enable row level security;

drop policy if exists "own selections: read" on public.workload_selections;
create policy "own selections: read"
  on public.workload_selections for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "own selections: insert" on public.workload_selections;
create policy "own selections: insert"
  on public.workload_selections for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "own selections: update" on public.workload_selections;
create policy "own selections: update"
  on public.workload_selections for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own selections: delete" on public.workload_selections;
create policy "own selections: delete"
  on public.workload_selections for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists workload_selections_user_idx
  on public.workload_selections (user_id);

-- ===================== 0035_typing_event_metrics.sql =====================
-- =====================================================================
-- SOPHIRA migration 0035 — honest typing event metrics (2026-10-13)
--
-- The original accuracy column is FINAL-TEXT accuracy: how closely the
-- submitted text matches the reference. That alone cannot distinguish a
-- flawless typist from one who mistyped and corrected everything (the
-- reported "100% accuracy despite backspacing" defect).
--
-- These OPTIONAL columns store the event summary the calibration UI
-- records (counts only — never what was typed):
--   raw_accuracy  how accurately characters were first entered (0..1)
--   corrections  wrong characters the user then deleted
--   backspaces   total deletions, correct or wrong
--
-- Non-destructive: add column if not exists; existing rows keep NULL
-- ("not captured by that attempt"), and every consumer treats NULL as
-- unknown rather than zero. RLS is unchanged (table policy 0009).
-- =====================================================================

alter table public.typing_attempts
  add column if not exists raw_accuracy numeric check (raw_accuracy is null or (raw_accuracy >= 0 and raw_accuracy <= 1)),
  add column if not exists corrections int check (corrections is null or corrections >= 0),
  add column if not exists backspaces int check (backspaces is null or backspaces >= 0);

-- ===================== 0036_invitation_email_status.sql =====================
-- =====================================================================
-- SOPHIRA migration 0036 — invitation email delivery status (2026-10-13)
--
-- The invitation lifecycle now sends the email through a configured
-- provider and records the HONEST outcome. The owner-only dashboard shows
-- this status; nothing here is a fabricated success:
--   email_status     'sent' | 'not_configured' | 'failed' | null (legacy rows)
--   email_error      safe-to-display reason when a send failed
--   email_sent_at    provider-accepted send time
-- Non-destructive: add column if not exists; legacy rows stay NULL.
-- =====================================================================

alter table public.invitations
  add column if not exists email_status text check (email_status in ('sent', 'not_configured', 'failed')),
  add column if not exists email_error text,
  add column if not exists email_sent_at timestamptz;

-- ===================== 0037_workspace_archive.sql =====================
-- =====================================================================
-- SOPHIRA migration 0037 — workspace archive lifecycle (2026-10-13)
--
-- ACTIVE -> ARCHIVED -> (separate, explicit) PERMANENT DELETION.
--
--   * archived_at IS NULL means ACTIVE (the default for every existing
--     row; nothing is archived by this migration, no data is rewritten).
--   * archived_at NOT NULL means REMOVED FROM THE ACTIVE WORKSPACE: the
--     row stays owned, intact, and restorable. Active lists, counts, and
--     AI retrieval exclude it (enforced server-side, not just in the UI).
--
-- Non-destructive: "add column if not exists" only. No table is dropped,
-- no RLS policy changes (ownership policies already scope every row to
-- its user), and restoring simply sets archived_at back to NULL.
-- =====================================================================

alter table public.notebooks        add column if not exists archived_at timestamptz;
alter table public.notebook_sources add column if not exists archived_at timestamptz;
alter table public.notebook_notes   add column if not exists archived_at timestamptz;
alter table public.notebook_questions add column if not exists archived_at timestamptz;
alter table public.notebook_evidence  add column if not exists archived_at timestamptz;
alter table public.notebook_artifacts add column if not exists archived_at timestamptz;

-- The archive view scans a user's rows by owner + state.
create index if not exists notebooks_active_idx on public.notebooks (user_id, archived_at);
create index if not exists notebook_sources_active_idx on public.notebook_sources (notebook_id, archived_at);
create index if not exists notebook_notes_active_idx on public.notebook_notes (notebook_id, archived_at);
create index if not exists notebook_questions_active_idx on public.notebook_questions (notebook_id, archived_at);
create index if not exists notebook_evidence_active_idx on public.notebook_evidence (notebook_id, archived_at);
create index if not exists notebook_artifacts_active_idx on public.notebook_artifacts (notebook_id, archived_at);

-- ===================== 0038_teacher_material_archive.sql =====================
-- =====================================================================
-- SOPHIRA migration 0038 — teachers + study materials join the archive
-- lifecycle (2026-10-13, post-archive audit round).
--
-- Same contract as 0037: archived_at NULL = ACTIVE (every existing row),
-- NOT NULL = removed from the active workspace but fully intact and
-- restorable. Additive only: no drops, no rewrites, RLS unchanged.
--
--   * teachers: archiving removes the teacher from active lists and
--     ACTIVE teacher context; courses that reference the teacher keep
--     their reference and fall back to honest "no teacher context".
--   * study_materials (Library): archiving removes the item from the
--     active Library and active study workflows; the DB row and any
--     storage object are preserved (no storage deletion on archive).
-- =====================================================================

alter table public.teachers        add column if not exists archived_at timestamptz;
alter table public.study_materials add column if not exists archived_at timestamptz;

create index if not exists idx_teachers_user_archived
  on public.teachers (user_id, archived_at);
create index if not exists idx_study_materials_user_archived
  on public.study_materials (user_id, archived_at);

-- ===================== 0039_supabase_security_hardening.sql =====================
-- ============================================================================
-- 0039: Supabase security advisor remediation (2026-10-15)
--
-- Addresses, without changing any behavior:
--   * function_search_path_mutable          -> explicit safe search paths
--   * anon_security_definer_function_executable
--   * authenticated_security_definer_function_executable
--     -> minimum-privilege execution grants per function, based on the ACTUAL
--        callers verified in the application code:
--          complete_first_owner   -> /api/complete-owner (service-role key)
--          get_invitation_by_token-> invitation signup (anonymous, required)
--          network_stats           -> /api/network/stats (authenticated owner;
--                                     the function also enforces owner-only)
--          handle_new_user         -> auth trigger (supabase_auth_admin only)
--          rls_auto_enable         -> administrative; not referenced anywhere
--                                     in the application -> dropped if present
--
-- ALTER FUNCTION ... SET is used instead of CREATE OR REPLACE so function
-- bodies, trigger behavior, and ownership are untouched.
-- ============================================================================

begin;

-- 1) touch_updated_at(): pin the search path (advisor: mutable search path).
alter function public.touch_updated_at() set search_path = pg_catalog;

-- 2) handle_new_user(): auth trigger on auth.users. It runs as the trusted
--    auth-admin role during signup; no client role ever needs EXECUTE.
alter function public.handle_new_user() set search_path = pg_catalog, public;
revoke execute on function public.handle_new_user() from PUBLIC, anon, authenticated;

-- 3) complete_first_owner(p_user_id uuid): one-time owner bootstrap. The
--    application calls it ONLY from /api/complete-owner using the
--    service-role key, and the function itself is atomic and single-use
--    (owner slot claimed once; refuses if any owner exists). Ordinary
--    clients must not be able to execute it at all.
alter function public.complete_first_owner(uuid) set search_path = pg_catalog, public;
revoke execute on function public.complete_first_owner(uuid) from PUBLIC, anon, authenticated;

-- 4) get_invitation_by_token(p_token text): anonymous lookup of ONE pending
--    invitation is genuinely required for invitation-only signup. Keep the
--    anon capability (scoped: pending-only, exact token, SECURITY DEFINER)
--    but remove the blanket PUBLIC grant.
alter function public.get_invitation_by_token(text) set search_path = pg_catalog, public;
revoke execute on function public.get_invitation_by_token(text) from PUBLIC;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- 5) network_stats(): owner-only aggregate (the function re-checks the
--    caller's role). Called by /api/network/stats with the signed-in
--    user's client -> authenticated needs EXECUTE; anon and PUBLIC do not.
alter function public.network_stats() set search_path = pg_catalog, public;
revoke execute on function public.network_stats() from PUBLIC, anon;
grant execute on function public.network_stats() to authenticated;

-- 6) rls_auto_enable(): an administrative helper that flips RLS on tables.
--    Nothing in the application or migrations invokes it; RLS belongs to
--    migrations/deployments. Clients must never execute it. If a copy
--    exists in this database, remove it (idempotent).
--    2BP01 fix: Supabase provisions an "ensure_rls" EVENT TRIGGER that calls
--    this function. Dropping the function first fails with
--    "cannot drop function ... because other objects depend on it".
--    Drop the dependent trigger first (IF EXISTS keeps this idempotent).
drop event trigger if exists ensure_rls;
drop function if exists public.rls_auto_enable();

commit;

-- ===================== 0040_document_history.sql =====================
-- =====================================================================
-- 0040: DOCUMENT HISTORY (cross-provider, 2026-10-26)
-- Owner-scoped record of document operations Sophira PERFORMED and
-- versions it actually OBSERVED. This is NOT an authorship detector and
-- stores no tokens. Snapshots (canonical text for Google Docs) are private
-- student work: RLS owner-only reads; writes happen exclusively through
-- the service role in /api/integrations/* routes.
-- Additive + reversible (dropping the table restores the prior schema).
-- =====================================================================

create table if not exists public.document_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  provider_document_id text not null,
  selection_id uuid references public.workload_selections(id) on delete set null,
  document_title text,
  document_url text,
  event_type text not null check (event_type in (
    'document_discovered','baseline_captured','document_read','draft_prepared',
    'insertion_attempted','insertion_confirmed','document_created',
    'replacement_attempted','replacement_confirmed',
    'external_change_observed','conflict_detected',
    'restore_attempted','restore_completed','restore_refused'
  )),
  actor text not null check (actor in ('user','sophira','external','provider')),
  provenance text not null check (provenance in (
    'sophira-generated','sophira-inserted','user-requested','user-confirmed',
    'external-observed','provider-reported','unknown'
  )),
  outcome text not null check (outcome in ('pending','confirmed','failed','conflicted','unavailable')),
  sequence integer not null,
  provider_revision text,
  previous_revision text,
  content_fingerprint text,
  previous_fingerprint text,
  snapshot_text text,
  snapshot_truncated boolean not null default false,
  snapshot_format text,
  target_section text,
  summary text not null,
  error_category text,
  diff_summary jsonb,
  observed_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  parent_event_id uuid references public.document_history(id) on delete set null,
  unique (user_id, provider, provider_document_id, sequence)
);

alter table public.document_history enable row level security;

-- The OWNER may read their own history. There are deliberately NO insert,
-- update, or delete policies: history rows are written only by the service
-- role inside authenticated API routes, so a client cannot forge or erase
-- events (and cannot insert rows for another user).
drop policy if exists "own document history: read" on public.document_history;
create policy "own document history: read"
  on public.document_history for select to authenticated
  using (auth.uid() = user_id);

create index if not exists document_history_doc_idx
  on public.document_history (user_id, provider, provider_document_id, sequence desc);

create index if not exists document_history_user_time_idx
  on public.document_history (user_id, recorded_at desc);
